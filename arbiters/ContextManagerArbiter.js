import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * ContextManagerArbiter
 * 
 * Manages the persistence of "Workspace State" (Pulse App State).
 * Unlike ConversationHistoryArbiter (which saves chat logs), this saves the 
 * actual working artifacts: Blueprints, Roadmaps, and Active Services.
 * 
 * Inspired by gemini-cli's session checkpointing.
 */
export class ContextManagerArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'ContextManagerArbiter',
      role: ArbiterRole.ARCHITECT,
      capabilities: [
        ArbiterCapability.READ_FILES,
        ArbiterCapability.WRITE_FILES
      ]
    });

    this.contextDir = path.join(process.cwd(), '.soma', 'context');
    this.activeContexts = new Map(); // projectId -> state
  }

  async onInitialize() {
    await fs.mkdir(this.contextDir, { recursive: true });
    this.auditLogger.info('ContextManager initialized', { dir: this.contextDir });
  }

  /**
   * Save the state of a specific project/workspace
   */
  async saveContext(projectId, state) {
    if (!projectId || !state) return { success: false, error: "Missing projectId or state" };

    try {
        const filePath = path.join(this.contextDir, `${projectId}.json`);
        const snapshot = {
            timestamp: Date.now(),
            projectId,
            state
        };

        // Write to disk
        await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
        
        // Update cache
        this.activeContexts.set(projectId, state);
        
        this.auditLogger.info(`[Context] Saved snapshot for ${projectId}`);
        return { success: true, timestamp: snapshot.timestamp };
    } catch (e) {
        this.auditLogger.error(`[Context] Save failed: ${e.message}`);
        return { success: false, error: e.message };
    }
  }

  /**
   * Load the state of a project
   */
  async loadContext(projectId) {
    try {
        const filePath = path.join(this.contextDir, `${projectId}.json`);
        
        // Check if exists
        try {
            await fs.access(filePath);
        } catch {
            return { success: false, reason: "No context found" };
        }

        const data = await fs.readFile(filePath, 'utf8');
        const snapshot = JSON.parse(data);
        
        this.activeContexts.set(projectId, snapshot.state);
        this.auditLogger.info(`[Context] Loaded snapshot for ${projectId}`);
        
        return { 
            success: true, 
            state: snapshot.state, 
            lastSaved: snapshot.timestamp 
        };
    } catch (e) {
        this.auditLogger.error(`[Context] Load failed: ${e.message}`);
        return { success: false, error: e.message };
    }
  }

  /**
   * List all saved projects
   */
  async listContexts() {
    try {
        const files = await fs.readdir(this.contextDir);
        const projects = files
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));
            
        return { success: true, projects };
    } catch (e) {
        return { success: false, error: e.message };
    }
  }
}

export default ContextManagerArbiter;
