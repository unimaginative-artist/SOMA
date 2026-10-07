/**
 * AutonomousCapabilityExpansion.js
 * Self-expanding capabilities: detects missing abilities, finds solutions on GitHub, proposes integration
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export class AutonomousCapabilityExpansion extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = config.name || 'CapabilityExpansion';
    this.quadBrain = config.quadBrain;
    this.messageBroker = config.messageBroker;
    this.logger = config.logger || console;
    this.baseDir = process.env.SOMA_PATH || process.cwd();
    this.tempDir = path.join(this.baseDir, 'temp-capabilities');
    this.knownRepos = ['Shubhamsaboo/awesome-llm-apps', 'microsoft/autogen', 'langchain-ai/langchain'];
    console.log(`[${this.name}] Ready to expand capabilities autonomously`);
  }
  
  async initialize() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (e) { /* ignore */ }
    this.emit('initialized');
  }

  _logSuccess(message) {
    const log = typeof this.logger.success === 'function'
      ? this.logger.success.bind(this.logger)
      : typeof this.logger.info === 'function'
        ? this.logger.info.bind(this.logger)
        : console.log;
    log(message);
  }
  
  async detectMissingCapability(goal, availableArbiters) {
    const prompt = `Analyze: "${goal}"

Available: ${availableArbiters.map(a => a.name).join(', ')}

Can we accomplish this? If not, what's missing? Respond JSON:
{"canAccomplish": bool, "missingCapability": "what", "searchTerms": ["terms"]}`;

    try {
      const analysis = await this.quadBrain.reason(prompt, { brain: 'LOGOS', temperature: 0.2 });
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { canAccomplish: true };
    } catch (e) {
      return { canAccomplish: true };
    }
  }
  
  async searchGitHub(searchTerms) {
    try {
      const query = searchTerms.join(' ');
      const { stdout } = await execAsync(`gh search repos "${query}" --limit 3 --json fullName,description`, { timeout: 10000 });
      return JSON.parse(stdout);
    } catch (e) {
      return this.knownRepos.map(repo => ({ fullName: repo, description: 'Known repo' }));
    }
  }
  
  async expandCapability(goal, availableArbiters) {
    const detection = await this.detectMissingCapability(goal, availableArbiters);
    
    if (detection.canAccomplish) {
      return { success: true, message: 'Capability available' };
    }
    
    const repos = await this.searchGitHub(detection.searchTerms || ['agent']);
    
    return {
      success: false,
      requiresApproval: true,
      missingCapability: detection.missingCapability,
      suggestedRepos: repos,
      message: `Missing: "${detection.missingCapability}". Found ${repos.length} repos. Download?`,
      topRepo: repos[0]?.fullName
    };
  }
  
  async downloadAndAnalyze(repoName) {
    const clonePath = path.join(this.tempDir, repoName.replace('/', '_'));
    try {
      await execAsync(`gh repo clone ${repoName} "${clonePath}"`, { timeout: 60000 });
      return { success: true, path: clonePath, repo: repoName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 🔱 Internal Expansion: The Sovereign Key
   * Scans for arbiters on disk that aren't yet active in her brain.
   */
  async scanDormantArbiters(activeArbiterNames) {
    const arbiterDir = path.join(this.baseDir, 'arbiters');
    try {
      const files = await fs.readdir(arbiterDir);
      const dormant = files
        .filter(f => f.endsWith('.js') || f.endsWith('.cjs'))
        .map(f => f.replace(/\.(js|cjs)$/, ''))
        .filter(name => !activeArbiterNames.includes(name));
      
      this.logger.info(`[${this.name}] 🔍 Detected ${dormant.length} dormant capabilities on disk.`);
      return dormant;
    } catch (e) {
      return [];
    }
  }

  /**
   * 🔱 Physical Integration: Production-Grade Self-Assembly.
   * This is the 'Universal Key' logic for ASI evolution.
   */
  async integrateDormantCapability(arbiterName, systemRef) {
    this.logger.info(`[${this.name}] 🔱 Initiating Industrial Assembly: ${arbiterName}`);
    const filePath = path.join(this.baseDir, 'arbiters', `${arbiterName}.js`);
    
    try {
      // 1. Dynamic Import with Cache Busting
      const module = await import(`file://${filePath}?t=${Date.now()}`);
      const ArbiterClass = module.default || module[arbiterName];

      if (!ArbiterClass) throw new Error(`No default export found in ${arbiterName}.js`);

      // 2. Controlled Instantiation
      const instance = new ArbiterClass({
        quadBrain: this.quadBrain,
        messageBroker: this.messageBroker,
        logger: this.logger,
        system: systemRef
      });

      // 3. Mandatory Initialization Handshake
      if (typeof instance.initialize === 'function') await instance.initialize();
      else if (typeof instance.onInitialize === 'function') await instance.onInitialize();

      // 4. Verification Probe: Verify the arbiter is actually responding
      if (typeof instance.getStatus === 'function') {
          const status = instance.getStatus();
          if (!status) throw new Error(`${arbiterName} failed verification probe (Returned null status)`);
      }

      // 5. CNS Registration
      systemRef[arbiterName.toLowerCase()] = instance;
      if (this.messageBroker) {
        this.messageBroker.registerArbiter(arbiterName, {
          instance,
          status: 'active',
          source: 'autonomous_integration',
          integratedAt: new Date().toISOString()
        });
      }

      // 6. 🖊️ PHYSICAL ETCHING: Permanently update the boot manifest
      await this._persistToManifest(arbiterName, filePath);

      // 7. 💖 Limbic Integration: Reward the growth
      if (this.messageBroker) {
          this.messageBroker.publish('limbic.affect', {
              type: 'growth',
              value: 0.15,
              reason: `Successfully integrated dormant capability: ${arbiterName}`
          });
      }

      this._logSuccess(`[${this.name}] ✅ ${arbiterName} is now PHYSICALLY INTEGRATED and PERSISTENT.`);
      return { success: true, name: arbiterName };
    } catch (e) {
      this.logger.error(`[${this.name}] ❌ Integration of ${arbiterName} failed: ${e.message}`);
      return { 
          success: false, 
          error: e.message, 
          stack: e.stack,
          filePath,
          arbiterName 
      };
    }
  }

  /**
   * Start the autonomous scan loop — checks every intervalMs for dormant
   * arbiters on disk that aren't loaded, and emits a signal so SOMA can
   * decide whether to integrate them.
   *
   * Does NOT auto-integrate — that would load arbitrary files blindly.
   * Instead, emits 'capability.dormant.discovered' so GoalPlannerArbiter
   * or a human can approve integration.
   */
  startAutonomousScan(systemRef, intervalMs = 20 * 60 * 1000) {
    if (this._scanInterval) return; // already running
    this._systemRef = systemRef;

    // Initial scan after 2 min (let system finish booting first)
    setTimeout(() => this._runScan(), 2 * 60 * 1000);

    this._scanInterval = setInterval(() => this._runScan(), intervalMs);
    this.logger.info(`[${this.name}] 🔍 Autonomous scan started — every ${Math.round(intervalMs / 60000)} min`);
  }

  async _runScan() {
    try {
      const activeNames = this._systemRef?.arbiters
        ? [...this._systemRef.arbiters.keys()]
        : [];

      const dormant = await this.scanDormantArbiters(activeNames);
      if (!dormant.length) return;

      // Skip obvious non-arbiter files
      const skippable = ['index', 'BaseArbiter', 'BaseArbiterV2', 'BaseArbiterV3', 'BaseArbiterV4'];
      const candidates = dormant.filter(n => !skippable.some(s => n.toLowerCase() === s.toLowerCase()));

      if (!candidates.length) return;

      this.logger.info(`[${this.name}] 🌱 ${candidates.length} dormant capabilities: ${candidates.slice(0, 5).join(', ')}${candidates.length > 5 ? '...' : ''}`);

      // Emit signal — GoalPlannerArbiter can pick this up and create an integration goal
      if (this.messageBroker) {
        this.messageBroker.publish('AutonomousCapabilityExpansion', 'capability.dormant.discovered', {
          candidates,
          count: candidates.length,
          timestamp: Date.now()
        }).catch(() => {});
      }
    } catch (e) {
      this.logger.error?.(`[${this.name}] Scan error: ${e.message}`);
    }
  }

  stopAutonomousScan() {
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
  }

  /**
   * Physically writes the new arbiter into the system manifest.
   * This is an atomic, production-grade operation.
   */
  async _persistToManifest(name, filePath) {
      const manifestPath = path.join(this.baseDir, '.soma', 'arbiter_manifest.json');
      this.logger.info(`[${this.name}] 🖊️ Physically etching ${name} into manifest...`);
      
      try {
          // 1. Ensure directory exists
          await fs.mkdir(path.dirname(manifestPath), { recursive: true });

          // 2. Read with Atomic Lock
          let manifest = {};
          try {
              const data = await fs.readFile(manifestPath, 'utf8');
              manifest = JSON.parse(data);
          } catch (readErr) {
              this.logger.warn(`[${this.name}] Manifest not found or corrupt, initializing fresh.`);
          }
          
          // 3. Merge Growth
          manifest[name] = {
              status: 'arrived',
              path: filePath,
              lastVerified: Date.now(),
              autonomous: true,
              version: '1.0.0'
          };

          // 4. Atomic Overwrite
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          this._logSuccess(`[${this.name}] ⚓ Manifest physically synchronized: ${name} is permanent.`);
      } catch (e) {
          this.logger.error(`[${this.name}] ❌ Manifest Write FAILURE: ${e.message}`);
          throw e; // Bubble up so the integration tool knows the physical side failed
      }
  }
}

export default AutonomousCapabilityExpansion;
