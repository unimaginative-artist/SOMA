import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn, exec } from 'child_process';
import os from 'os';

/**
 * EngineeringSwarmRuntime.js (PRO Edition)
 * 
 * The non-simulated execution heart of the SOMA Engineering Swarm.
 * Handles parallel real-world actions, artifact versioning, and weighted truth merging.
 */

const uid = (p = 'id') => `${p}_${crypto.randomBytes(6).toString('hex')}`;

export class Artifact {
  constructor({ type, content, producedBy, confidence = 0.9, metadata = {} }) {
    this.artifactId = uid('artifact');
    this.type = type;               // 'file', 'diff', 'log', 'report', 'binary'
    this.content = content;
    this.producedBy = producedBy;   // Agent ID or Persona Name
    this.confidence = confidence;
    this.timestamp = new Date().toISOString();
    this.metadata = metadata;
  }
}

export class SwarmTask {
  constructor({ description, command, cwd, priority = 1, timeout = 30000 }) {
    this.taskId = uid('task');
    this.description = description;
    this.command = command;
    this.cwd = cwd;
    this.priority = priority;
    this.timeout = timeout;
    this.status = 'pending';
    this.result = null;
  }
}

export class SwarmEngine {
  constructor({ workspace, concurrency = os.cpus().length, logger }) {
    this.workspace = workspace;
    this.concurrency = Math.max(1, concurrency);
    this.logger = logger || console;
    this.queue = [];
    this.activeWorkers = 0;
    this.artifactLedger = [];
    this.stats = { tasksRun: 0, artifactsMerged: 0, failures: 0 };
  }

  async initialize() {
    await fs.mkdir(this.workspace, { recursive: true });
    console.log(`[SwarmRuntime] Workspace ready: ${this.workspace} (Concurrency: ${this.concurrency})`);
  }

  /**
   * Parallel Execution Engine
   */
  async runTasks(tasks) {
    return new Promise((resolve) => {
      if (!tasks || tasks.length === 0) return resolve([]);

      // Sort by priority (descending)
      this.queue.push(...tasks.sort((a, b) => b.priority - a.priority));

      const processNext = () => {
        if (this.queue.length === 0 && this.activeWorkers === 0) {
          return resolve(this.artifactLedger);
        }

        while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
          const task = this.queue.shift();
          this.activeWorkers++;
          this.stats.tasksRun++;

          this._executeTask(task)
            .then(result => {
              this._weightedMerge(result.artifacts);
              this.activeWorkers--;
              processNext();
            })
            .catch(err => {
              console.error(`[SwarmRuntime] Task ${task.taskId} failed: ${err.message}`);
              this.stats.failures++;
              this.activeWorkers--;
              processNext();
            });
        }
      };

      processNext();
    });
  }

  async _executeTask(task) {
    return new Promise((resolve) => {
      task.status = 'running';
      const artifacts = [];
      const startTime = Date.now();

      // 🛡️ The Ralph Sandbox (Industrial Logic)
      const scrubbedCommand = task.command.replace(/[&|;]/g, '');

      // Build a safe, functional Windows environment
      const safeEnv = {};
      const blacklist = ['API', 'KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'SOMA_BACKEND_URL'];
      const windowsEssentials = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'];

      Object.keys(process.env).forEach(key => {
          const upperKey = key.toUpperCase();
          const isBlacklisted = blacklist.some(b => upperKey.includes(b));
          const isEssential = windowsEssentials.includes(upperKey);
          
          if (isEssential || !isBlacklisted) {
              safeEnv[key] = process.env[key];
          }
      });

      const proc = spawn(scrubbedCommand, {
        shell: true, 
        cwd: task.cwd,
        env: {
            ...safeEnv,
            NODE_ENV: 'sandbox',
            SOMA_SANDBOXED: 'true'
        },
        timeout: task.timeout || 10000,
        killSignal: 'SIGKILL' // 🪓 No-bullshit termination
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());

      // 🛡️ The Ralph Sandbox (Process Tree Guillotine)
      const timeoutLimit = task.timeout || 10000;
      let isTimedOut = false;

      const killTimer = setTimeout(() => {
          isTimedOut = true;
          this.logger.warn(`[SwarmRuntime] ⌛ Task ${task.taskId} timed out after ${timeoutLimit}ms. Executing hard kill.`);
          
          // Physically wipe the process tree on Windows
          exec(`taskkill /F /T /PID ${proc.pid}`, (err) => {
              // We resolve even if taskkill fails, because the timeout IS the result.
              task.status = 'timeout';
              resolve({ 
                  task, 
                  artifacts, 
                  exitCode: 1, 
                  error: `Task timed out after ${timeoutLimit}ms. Hard kill executed.` 
              });
          });
      }, timeoutLimit);

      proc.on('close', (code, signal) => {
        if (isTimedOut) return; // Already handled by killTimer
        clearTimeout(killTimer);
        
        task.status = (code === 0) ? 'done' : 'failed';
        const duration = Date.now() - startTime;

        this.logger.debug(`[SwarmRuntime] Task ${task.taskId} closed. Code: ${code}, Signal: ${signal}`);

        if (stdout.trim()) {
          artifacts.push(new Artifact({
            type: 'log',
            content: stdout.trim(),
            producedBy: `worker_${task.taskId}`,
            confidence: 0.9,
            metadata: { duration, exitCode: code, signal }
          }));
        }

        if (stderr.trim()) {
          artifacts.push(new Artifact({
            type: 'log',
            content: stderr.trim(),
            producedBy: `worker_${task.taskId}`,
            confidence: 0.3, // Lower confidence for error streams
            metadata: { duration, exitCode: code, isError: true }
          }));
        }

        resolve({ task, artifacts, exitCode: code });
      });

      proc.on('error', (err) => {
        task.status = 'error';
        resolve({ task, artifacts: [], error: err.message });
      });
    });
  }

  /**
   * Weighted Merge (Borrowed from RuntimePro)
   * Intelligently merges artifacts into the source of truth ledger.
   */
  _weightedMerge(newArtifacts) {
    for (const artifact of newArtifacts) {
      // Logic: If we have multiple logs or reports for the same 'intent', 
      // we only keep the one with higher confidence or newer timestamp.
      const duplicateIdx = this.artifactLedger.findIndex(a => 
        a.type === artifact.type && a.producedBy === artifact.producedBy
      );

      if (duplicateIdx === -1) {
        this.artifactLedger.push(artifact);
        this.stats.artifactsMerged++;
      } else {
        if (artifact.confidence >= this.artifactLedger[duplicateIdx].confidence) {
          this.artifactLedger[duplicateIdx] = artifact;
        }
      }
    }
  }

  clearLedger() {
    this.artifactLedger = [];
  }
}