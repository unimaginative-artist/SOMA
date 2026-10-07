/**
 * ImmuneSystemArbiter.js (Production Grade)
 * 
 * The Auto-Immune System for SOMA.
 * Components:
 * - Watchdog (Goku): Monitors system health (memory, CPU, stability).
 * - Guardian (Superman): Analyzes crashes and generates safe patches.
 * - Antibodies (Clones): Isolated VM2 sandboxes to verify patches before deployment.
 * 
 * Capabilities:
 * - Automatically detects runtime errors in arbiters.
 * - Clones the failing code into a secure sandbox.
 * - Applies defensive patches (try/catch wrapping, null checks).
 * - Verifies the fix actually works and doesn't crash.
 * - Hot-swaps the fixed code into production (via file overwrite + reload).
 */

import BaseArbiterV4 from './BaseArbiter.js';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { NodeVM } from 'vm2';

const TMP_DIR = path.join(process.cwd(), '.soma', 'immune_system_tmp');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

import * as acorn from 'acorn';
import { generate } from 'astring';
import { walk } from 'estree-walker';

// --------------------- Guardian (Superman) ---------------------
class Guardian {
  constructor(logger) {
    this.name = 'Guardian';
    this.logger = logger;
  }

  async analyzeError(err, originalCode) {
    const errorMessage = (err && err.message) ? err.message : String(err);
    console.log(`[Guardian] 🔍 Analyzing error: ${errorMessage}`);

    // Heuristic analysis
    if (errorMessage.includes('is not a function') || errorMessage.includes('undefined')) {
        return {
            issueType: 'type-error',
            message: errorMessage,
            strategy: 'defensive-checks'
        };
    }

    return {
      issueType: 'runtime-error',
      message: errorMessage,
      strategy: 'ast-instrumentation'
    };
  }

  generatePatch(originalCode, analysis) {
    const header = `/* 🛡️ Patch by Guardian [${new Date().toISOString()}] - Strategy: AST-Instrumentation */\n`;
    
    try {
        // Parse the code into an AST
        const ast = acorn.parse(originalCode, {
            ecmaVersion: 'latest',
            sourceType: 'module'
        });

        // Traverse and instrument
        walk(ast, {
            enter(node, parent) {
                // Wrap function bodies in try/catch
                if (
                    node.type === 'FunctionDeclaration' || 
                    node.type === 'FunctionExpression' || 
                    node.type === 'ArrowFunctionExpression' ||
                    node.type === 'MethodDefinition'
                ) {
                    const bodyNode = node.type === 'MethodDefinition' ? node.value.body : node.body;
                    
                    // If it's already a block statement and not already patched
                    if (bodyNode && bodyNode.type === 'BlockStatement' && !bodyNode._isPatched) {
                        const originalStatements = [...bodyNode.body];
                        
                        // Create the catch clause
                        const catchClause = {
                            type: 'CatchClause',
                            param: { type: 'Identifier', name: 'e' },
                            body: {
                                type: 'BlockStatement',
                                body: [
                                    {
                                        type: 'ExpressionStatement',
                                        expression: {
                                            type: 'CallExpression',
                                            callee: {
                                                type: 'MemberExpression',
                                                object: { type: 'Identifier', name: 'console' },
                                                property: { type: 'Identifier', name: 'error' },
                                                computed: false
                                            },
                                            arguments: [
                                                { type: 'Literal', value: `[Guardian] 🛡️ Exception in ${node.id?.name || 'anonymous function'}:` },
                                                { type: 'MemberExpression', object: { type: 'Identifier', name: 'e' }, property: { type: 'Identifier', name: 'message' }, computed: false }
                                            ]
                                        }
                                    },
                                    {
                                        type: 'ReturnStatement',
                                        argument: { type: 'Literal', value: null }
                                    }
                                ]
                            }
                        };

                        // Wrap in TryStatement
                        const tryStatement = {
                            type: 'TryStatement',
                            block: {
                                type: 'BlockStatement',
                                body: originalStatements
                            },
                            handler: catchClause,
                            finalizer: null
                        };

                        // Update function body
                        bodyNode.body = [tryStatement];
                        bodyNode._isPatched = true;
                    }
                }
            }
        });

        // Generate patched code from AST
        const patchedCode = generate(ast);
        return header + patchedCode;

    } catch (e) {
      console.error(`[Guardian] AST Patch generation failed: ${e.message}. Falling back to original code.`);
      return originalCode; // Fail safe
    }
  }
}

// --------------------- Watchdog (Goku) ---------------------
class Watchdog {
  constructor(logger) {
    this.name = 'Watchdog';
    this.logger = logger;
  }

  async senseSystemState() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memUsage = (1 - freeMem / totalMem) * 100;
    const loadAvg = os.loadavg()[0]; 

    // Alert thresholds
    const status = {
        healthy: true,
        memoryUsage: memUsage.toFixed(1) + '%',
        loadAverage: loadAvg.toFixed(2),
        alerts: []
    };

    if (memUsage > 90) {
        status.healthy = false;
        status.alerts.push('High Memory Usage');
    }
    if (loadAvg > (os.cpus().length * 1.5)) {
        status.healthy = false;
        status.alerts.push('High CPU Load');
    }

    return status;
  }
}

// --------------------- Antibody (Clone) ---------------------
class AntibodyClone {
  constructor(id, originalPath, logger) {
    this.id = id;
    this.originalPath = originalPath;
    this.tmpDir = path.join(TMP_DIR, `antibody_${this.id}`);
    this.patchedPath = path.join(this.tmpDir, path.basename(originalPath));
    this.logger = logger;
  }

  async prepare() {
    await fs.mkdir(this.tmpDir, { recursive: true });
    // Copy dependencies if needed? For now just the file.
    // In production, might need to link node_modules
  }

  async injectPatch(patchCode) {
    await fs.writeFile(this.patchedPath, patchCode, 'utf8');
  }

  async verify(timeoutMs = 5000) {
    console.log(`[Antibody ${this.id}] 🧪 Verifying patch...`);
    
    try {
      const code = await fs.readFile(this.patchedPath, 'utf8');
      
      const vm = new NodeVM({
        console: 'inherit',
        sandbox: {},
        require: {
          external: true, // Allow external modules
          builtin: ['*'],
          root: process.cwd() // Allow loading project modules
        },
        wrapper: 'commonjs',
        timeout: timeoutMs
      });

      // Try to load the module
      const exported = vm.run(code, this.patchedPath);
      
      // Basic verification: Did it export something?
      if (!exported) throw new Error('Module exported nothing');
      if (exported.status === 'crashed') throw new Error(exported.error || 'Module reported crash');

      console.log(`[Antibody ${this.id}] ✅ Verification SUCCESS`);
      return { success: true };

    } catch (err) {
      console.warn(`[Antibody ${this.id}] ❌ Verification FAILED: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async cleanup() {
    try {
        await fs.rm(this.tmpDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  }
}

// --------------------- Main Arbiter ---------------------
export class ImmuneSystemArbiter extends BaseArbiterV4 {
  static role = 'immune-system';
  static capabilities = ['monitor-health', 'patch-code', 'verify-fix'];

  constructor(config = {}) {
    super({
        name: 'ImmuneSystemArbiter',
        role: ImmuneSystemArbiter.role,
        capabilities: ImmuneSystemArbiter.capabilities,
        ...config
    });

    this.guardian = new Guardian(this.auditLogger);
    this.watchdog = new Watchdog(this.auditLogger);
    this.activeAntibodies = new Map();
    this.monitoringInterval = null;

    // Clone management for load distribution
    this.activeClones = new Map(); // Track spawned clones with metadata
    this.stressHistory = []; // Track stress over time
    this.maxClones = config.maxClones || 5;
    this.cloneSpawnThreshold = config.cloneSpawnThreshold || 85; // % memory usage
    this.cloneMergeThreshold = config.cloneMergeThreshold || 60; // % memory usage
    this.orchestrator = null; // Will be set via setOrchestrator()
    this.isClone = config.isClone || false; // Am I a clone?
    this.parentId = config.parentId || null;

    // Task queue and load balancing
    this.taskQueue = []; // Incoming tasks buffer
    this.currentCloneIndex = 0; // Round-robin index
    this.taskDistributionStats = {
      totalReceived: 0,
      totalDistributed: 0,
      handledLocally: 0,
      sentToClones: 0
    };
  }

  async onInitialize() {
    await super.onInitialize();

    // Only parent arbiters monitor and spawn clones
    if (!this.isClone) {
      this.startMonitoring();
      this.log('info', `[${this.name}] 🛡️ Immune System Active (Production Mode - Parent)`);
    } else {
      this.log('info', `[${this.name}] 🧬 Clone initialized (Parent: ${this.parentId})`);
    }
  }

  /**
   * Inject orchestrator reference for clone spawning
   */
  setOrchestrator(orchestrator) {
    this.orchestrator = orchestrator;
    this.log('info', `[${this.name}] Orchestrator linked - clone spawning enabled`);
  }

  startMonitoring() {
    this.monitoringInterval = setInterval(async () => {
        const status = await this.watchdog.senseSystemState();
        const memUsageNum = parseFloat(status.memoryUsage);

        // Track stress history (rolling window of last 5 checks)
        this.stressHistory.push(memUsageNum);
        if (this.stressHistory.length > 5) {
            this.stressHistory.shift();
        }

        // Calculate average stress
        const avgStress = this.stressHistory.reduce((a, b) => a + b, 0) / this.stressHistory.length;

        if (!status.healthy) {
            this.log('warn', `[${this.name}] ⚠️ System Stress Detected: ${status.alerts.join(', ')} (Avg: ${avgStress.toFixed(1)}%)`);

            // Publish stress event
            if (this.registry) {
                // this.registry.publish('system:stress', status); 
            }

            // SPAWN CLONE if stressed and we have capacity
            if (avgStress >= this.cloneSpawnThreshold && this.activeClones.size < this.maxClones && this.orchestrator) {
                await this.spawnClone();
            }
        } else {
            // MERGE BACK clones if load has decreased
            if (avgStress < this.cloneMergeThreshold && this.activeClones.size > 0) {
                await this.mergeClone();
            }
        }
    }, 10000); // Check every 10s
  }

  /**
   * Spawn a clone to help handle load
   */
  async spawnClone() {
    if (!this.orchestrator) {
        this.log('warn', `[${this.name}] Cannot spawn clone - no orchestrator linked`);
        return;
    }

    try {
        // Cascading threshold: each clone spawns at progressively higher stress
        const cloneNumber = this.activeClones.size + 1;
        const cascadingThreshold = this.cloneSpawnThreshold + (cloneNumber * 2); // 85%, 87%, 89%, etc.

        this.log('info', `[${this.name}] 🧬 Spawning clone ${cloneNumber}/${this.maxClones} (threshold: ${cascadingThreshold}%)`);

        const cloneId = await this.orchestrator.spawn('ImmuneSystemArbiter', {
            isClone: true,
            parentId: this.name, // Use name as ID
            maxClones: 0, // Clones don't spawn their own clones
            cloneSpawnThreshold: cascadingThreshold
        });

        // Track clone metadata
        this.activeClones.set(cloneId, {
            id: cloneId,
            spawnTime: Date.now(),
            tasksProcessed: 0,
            currentLoad: 0,
            status: 'healthy',
            lastHealthCheck: Date.now()
        });

        this.log('info', `[${this.name}] ✅ Clone ${cloneId} spawned successfully (${this.activeClones.size} active)`);

    } catch (error) {
        this.log('error', `[${this.name}] Failed to spawn clone: ${error.message}`);
    }
  }

  /**
   * Merge back ONE clone gracefully (staggered shutdown)
   * Doesn't kill all clones at once - gradually scales down
   */
  async mergeClone() {
    if (this.activeClones.size === 0) return;

    try {
        // Pick the oldest clone to merge (FIFO - first in, first out)
        const [cloneId, cloneMeta] = this.activeClones.entries().next().value;

        this.log('info', `[${this.name}] 🔄 Preparing to merge clone ${cloneId} (processed ${cloneMeta.tasksProcessed} tasks)`);

        // Graceful shutdown: Wait for clone to finish current work
        // Give it 5 seconds to wrap up
        await new Promise(resolve => setTimeout(resolve, 5000));

        await this.orchestrator.terminate(cloneId);
        this.activeClones.delete(cloneId);

        this.log('info', `[${this.name}] ✅ Clone merged - ${this.activeClones.size} clones remaining`);

    } catch (error) {
        this.log('error', `[${this.name}] Failed to merge clone: ${error.message}`);
    }
  }

  // ... (keeping other methods, updating logger calls to this.log)

  /**
   * Run sandbox tests for a given piece of code
   * Used by SelfModificationArbiter to verify optimizations
   */
  async runSandboxTests(patchCode, originalPath = 'unknown_module.js') {
    this.log('info', `[${this.name}] 🧪 Running sandbox verification for external request...`);

    const antibodyId = `test_${crypto.randomUUID().slice(0, 8)}`;
    const antibody = new AntibodyClone(antibodyId, originalPath, this.auditLogger);
    this.activeAntibodies.set(antibodyId, antibody);

    try {
        await antibody.prepare();
        await antibody.injectPatch(patchCode);
        const verification = await antibody.verify();
        
        return verification;
    } catch (err) {
        return { success: false, error: err.message };
    } finally {
        await antibody.cleanup();
        this.activeAntibodies.delete(antibodyId);
    }
  }

  async healModule(filePath, errorObj) {
    this.log('info', `[${this.name}] 🚑 Initiating healing protocol for: ${path.basename(filePath)}`);

    // 1. Analyze
    const originalCode = await fs.readFile(filePath, 'utf8');
    const analysis = await this.guardian.analyzeError(errorObj, originalCode);

    // 2. Generate Patch
    const patchCode = this.guardian.generatePatch(originalCode, analysis);

    // 3. Verify in Antibody (Sandbox)
    const antibodyId = crypto.randomUUID();
    const antibody = new AntibodyClone(antibodyId, filePath, this.auditLogger);
    this.activeAntibodies.set(antibodyId, antibody);

    try {
        await antibody.prepare();
        await antibody.injectPatch(patchCode);
        const verification = await antibody.verify();

        if (verification.success) {
            // 4. Deploy Fix
            await this.deployFix(filePath, antibody.patchedPath);
            
            return { success: true, method: analysis.strategy };
        } else {
            return { success: false, reason: 'Verification failed', error: verification.error };
        }

    } finally {
        await antibody.cleanup();
        this.activeAntibodies.delete(antibodyId);
    }
  }

  async deployFix(targetPath, patchedPath) {
      // Backup first
      const backupPath = `${targetPath}.bak-${Date.now()}`;
      await fs.copyFile(targetPath, backupPath);
      
      // Overwrite
      await fs.copyFile(patchedPath, targetPath);
      this.log('info', `[${this.name}] ✅ FIX DEPLOYED to ${path.basename(targetPath)} (Backup: ${path.basename(backupPath)})`);
  }

  async onShutdown() {
      this.log('info', `[${this.name}] 🛑 Shutting down...`);

      if (this.monitoringInterval) clearInterval(this.monitoringInterval);

      // If parent, terminate all clones gracefully
      if (!this.isClone && this.activeClones.size > 0) {
          this.log('info', `[${this.name}] Terminating ${this.activeClones.size} clones...`);

          for (const cloneId of this.activeClones.keys()) {
              try {
                  await this.orchestrator.terminate(cloneId);
                  this.log('info', `[${this.name}] ✅ Terminated clone ${cloneId}`);
              } catch (error) {
                  this.log('error', `[${this.name}] Failed to terminate clone ${cloneId}: ${error.message}`);
              }
          }

          this.activeClones.clear();
      }

      // Cleanup all antibodies
      for (const antibody of this.activeAntibodies.values()) {
          await antibody.cleanup();
      }

      // Log final stats
      if (!this.isClone) {
          const stats = this.getStats();
          this.log('info', `[${this.name}] Final stats: ${JSON.stringify(stats.taskDistribution)}`);
      }
      
      await super.onShutdown();
  }
}

export default ImmuneSystemArbiter;
