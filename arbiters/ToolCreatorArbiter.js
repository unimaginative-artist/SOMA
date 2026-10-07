import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyInChildProcess } = require('./ToolVerifierWorker.cjs');

/**
 * ToolCreatorArbiter
 * 
 * SOMA's "Meta-Tool" - Capable of writing, testing, and registering new tools on the fly.
 * Inspired by Doriandarko/claude-engineer.
 * 
 * Workflow:
 * 1. Receive request for missing capability (e.g. "Scan PDF for keywords").
 * 2. Generate tool code (Node.js/Python).
 * 3. Write tool to .soma/tools directory.
 * 4. Register tool with ToolRegistry.
 * 5. Return tool definition for immediate use.
 */
export class ToolCreatorArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'ToolCreatorArbiter',
      role: ArbiterRole.ARCHITECT,
      capabilities: [
        ArbiterCapability.WRITE_FILES,
        ArbiterCapability.EXECUTE_CODE,
        ArbiterCapability.READ_FILES
      ]
    });

    this.quadBrain = opts.quadBrain || null;
    // Output to SOMA/skills/shared/ so SkillWatcherArbiter auto-detects new skills
    this.toolDir = path.join(process.cwd(), 'SOMA', 'skills', 'shared');
    this.registry = opts.toolRegistry || null;
    this.skillWatcher = opts.skillWatcher || null;
  }

  async onInitialize() {
    // Ensure tool directory exists
    await fs.mkdir(this.toolDir, { recursive: true });
    this.auditLogger.info('ToolCreator initialized', { toolDir: this.toolDir });
  }

  /**
   * Main entry point: Create a new tool from a description
   * @param {string} toolName - Name of the tool (e.g. "pdf_scanner")
   * @param {string} description - What the tool should do
   */
  async createTool(toolName, description) {
    this.auditLogger.info(`🛠️ [ToolCreator] Synthesizing tool: ${toolName}`);
    
    // 1. Generate Tool Code (The "Spec")
    const spec = await this._generateToolSpec(toolName, description);
    
    // 2. Validate/Review (Engineering Swarm Logic Light)
    // In a full implementation, we'd pass this to EngineeringSwarm for review.
    // For now, we trust the QuadBrain's output with basic checks.
    
    // 3. Write to Disk
    const filename = `${toolName}.js`; // Defaulting to Node.js tools for SOMA integration
    const filePath = path.join(this.toolDir, filename);
    
    await fs.writeFile(filePath, spec.code, 'utf8');
    
    // 3.5. Verify Tool (Jupyter-Style Execution)
    const verification = await this.verifyTool(filePath);
    if (!verification.success) {
        this.auditLogger.warn(`[ToolCreator] Tool verification failed: ${verification.error}`);
        // We might still register it but flag it, or return error. 
        // For now, let's append a warning but allow registration for manual fix.
        spec.description += ` (⚠️ Verification Failed: ${verification.error})`;
    } else {
        this.auditLogger.info(`[ToolCreator] Tool verified successfully. Output: ${JSON.stringify(verification.result)}`);
    }

    // 4. Register
    if (this.registry) {
        try {
            // Use createRequire to bypass ESM limitations for dynamically loading CJS tools
            const dynamicRequire = createRequire(import.meta.url);
            const toolModule = dynamicRequire(filePath);
            
            if (toolModule && toolModule.execute) {
                await this.registry.registerTool({
                    name: toolName,
                    description: spec.description,
                    parameters: spec.parameters,
                    execute: toolModule.execute
                });
                this.auditLogger.info(`✅ [ToolCreator] Tool '${toolName}' dynamic-loaded and registered.`);
            } else {
                this.auditLogger.warn(`[ToolCreator] Tool '${toolName}' module is invalid or missing execute()`);
            }
        } catch (regErr) {
            this.auditLogger.error(`[ToolCreator] Failed to register tool '${toolName}': ${regErr.message}`);
        }
    }

    this.auditLogger.info(`✅ [ToolCreator] Process for '${toolName}' complete.`);
    
    return {
        success: true,
        toolName,
        path: filePath,
        usage: spec.usageExample,
        verified: verification.success
    };
  }

  async verifyTool(filePath) {
    try {
        // PRODUCTION HARDENING: Run in isolated child process
        // This protects the main thread from infinite loops or crashes in generated code.
        const verification = await verifyInChildProcess(filePath, 3000); // 3s timeout
        return verification;
    } catch (e) {
        return { success: false, error: `Verification System Error: ${e.message}` };
    }
  }

  async _generateToolSpec(name, description) {
    if (!this.quadBrain) throw new Error("QuadBrain needed for tool synthesis");

    const prompt = `
    You are a Senior Tool Engineer for the SOMA AI system.
    Create a Node.js skill file that implements the following tool:
    
    NAME: ${name}
    DESCRIPTION: ${description}
    
    REQUIREMENTS:
    1. Must be a CommonJS module (module.exports = { ... }).
    2. Must export: name (string), description (string), parameters (object with type/properties/required), execute (async function).
    3. The execute function receives (params, context) where context has { system, logger, skillWatcher }.
    4. Must return { success: boolean, message: string } or { success: boolean, data: any, error: string }.
    5. Include error handling with try/catch.
    6. Use standard Node.js libraries where possible.
    
    EXAMPLE SKILL FORMAT:
    module.exports = {
        name: 'example_tool',
        description: 'Does something useful',
        parameters: { type: 'object', properties: { input: { type: 'string', description: 'The input' } }, required: ['input'] },
        execute: async ({ input }, { system, logger }) => {
            return { success: true, message: 'Result here' };
        }
    };
    
    OUTPUT JSON FORMAT:
    {
        "code": "full javascript code string",
        "description": "short description for registry",
        "parameters": { "paramName": "type" },
        "usageExample": "example call"
    }
    `;

    // Use LOGOS (Analytical) for code generation
    let result;
    if (this.quadBrain.callLOGOS) {
        const resp = await this.quadBrain.callLOGOS(prompt);
        result = resp.response;
    } else {
        result = await this.quadBrain.callBrain('LOGOS', prompt, {}, 'full');
    }

    // Parse JSON (handle potential markdown wrapping)
    const cleanJson = result.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  }
}

export default ToolCreatorArbiter;
