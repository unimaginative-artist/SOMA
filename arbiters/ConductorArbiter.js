
import BaseArbiterV4 from './BaseArbiter.js';
const BaseArbiter = BaseArbiterV4; // Alias for compatibility
import fs from 'fs/promises';
import path from 'path';

export class ConductorArbiter extends BaseArbiter {
  static role = 'conductor';
  static capabilities = [
    'generate-arbiter',
    'self-optimize',
    'version-control',
    'self-document',
    'collaborative-generate',
    'hot-load'
  ];

  constructor(config = {}) {
    super({
        name: 'ConductorArbiter',
        role: ConductorArbiter.role,
        capabilities: ConductorArbiter.capabilities,
        ...config
    });
    
    // Configurable repo path, defaults to SOMA/arbiters/generated
    this.rootPath = process.cwd();
    this.arbiterRepoPath = path.join(this.rootPath, 'SOMA', 'arbiters', 'generated');
    this.versionIndex = {};
    
    // We don't need to instantiate MessageBroker, BaseArbiter has 'this.broker'
    this.brain = null; // Will be injected via setBrain
  }

  async initialize() {
    await super.initialize();
    await this.ensureRepo();
    console.log(`[${this.name}] Conductor initialized. Repo: ${this.arbiterRepoPath}`);
  }

  // Dependency Injection for the Brain
  setBrain(brain) {
      this.brain = brain;
      console.log(`[${this.name}] Brain connected.`);
  }

  async ensureRepo() {
    try {
      await fs.mkdir(this.arbiterRepoPath, { recursive: true });
    } catch (err) {
      console.error(`[${this.name}] Failed to create arbiter repo:`, err);
    }
  }

  async execute(task) {
      return this.processTask(task);
  }

  async processTask(task) {
    // BaseArbiter metrics handled automatically
    try {
      const { type, payload } = task;

      switch (type) {
        case 'generate-arbiter':
          return await this.generateArbiter(payload.description, payload.name);

        case 'self-optimize':
          return await this.selfOptimize();

        case 'version-control':
          return await this.versionControl(payload.arbiterName);

        case 'self-document':
          return await this.generateDocumentation(payload.arbiterName);

        case 'hot-load':
            return await this.hotLoadArbiter(payload.arbiterName);

        default:
          throw new Error(`Unknown task type: ${type}`);
      }
    } catch (err) {
        console.error(`[${this.name}] Task failed: ${err.message}`);
        throw err;
    }
  }

  async generateArbiter(description, requestedName) {
    console.log(`[${this.name}] Generating arbiter: ${description}`);

    if (!this.brain) {
        throw new Error('Brain not connected. Cannot generate code.');
    }

    const prompt = this.buildConductorPrompt(description);
    
    // Use LOGOS (Analytical/Coding Brain)
    let responseText = '';
    try {
        // Assuming brain interface allows callBrain or similar
        // Adjust based on actual brain implementation available
        const result = await this.brain.callBrain('LOGOS', prompt, { temperature: 0.2 });
        responseText = result.text || result.response || result;
    } catch (e) {
        // Fallback or error
        throw new Error(`Brain generation failed: ${e.message}`);
    }

    const generated = this.parseGeneratedCode(responseText, requestedName);
    
    // Safety check
    const validation = await this.validateCode(generated.code);
    if (!validation.safe) {
      console.warn(`[${this.name}] Code validation failed: ${validation.reason}`);
      throw new Error(`Arbiter generation unsafe: ${validation.reason}`);
    }

    // Version and Store
    const finalName = requestedName || generated.arbiterName;
    const filePath = await this.storeArbiterVersion(finalName, generated.code);

    // Broadcast success
    if (this.broker) {
        this.broker.broadcast('arbiter-generated', {
            arbiterName: finalName,
            role: generated.role,
            path: filePath
        });
    }

    return {
      success: true,
      name: finalName,
      role: generated.role,
      path: filePath,
      metadata: generated.metadata
    };
  }

  async hotLoadArbiter(arbiterName) {
      // Logic to dynamic import() the new file and instantiate it
      // This allows "Hot Loading" without restart
      console.log(`[${this.name}] Attempting to hot-load ${arbiterName}...`);
      
      const versions = await this.versionControl(arbiterName);
      if (!versions.versions || versions.versions.length === 0) {
          throw new Error(`No versions found for ${arbiterName}`);
      }
      
      // Get latest
      const latestFile = versions.versions.sort().pop();
      const fullPath = path.join(this.arbiterRepoPath, latestFile);
      const fileUrl = 'file://' + fullPath.replace(/\\/g, '/'); // Windows fix

      try {
        const module = await import(fileUrl);
        // Assuming default export or named export matches class name
        const ClassRef = module[arbiterName] || module.default;
        
        if (!ClassRef) throw new Error(`Could not find class export in ${latestFile}`);

        const instance = new ClassRef();
        await instance.initialize();
        
        console.log(`[${this.name}] successfully hot-loaded ${arbiterName}`);
        return { success: true, instanceId: instance.id };
      } catch (e) {
          console.error(`[${this.name}] Hot-load failed:`, e);
          throw e;
      }
  }

  buildConductorPrompt(description) {
    return `You are the Conductor. Your task is to generate a new Node.js Arbiter class for the SOMA system based on this description:
    
    "${description}"

    REQUIREMENTS:
    1. It MUST extend 'BaseArbiter' (assume import from '../../core/BaseArbiter.js').
    2. It MUST have a constructor calling super() with name, role, and capabilities.
    3. It MUST have an execute(task) or processTask(task) method.
    4. Provide the output as a JSON object with this structure:
    {
        "arbiterName": "NameArbiter",
        "role": "specific-role",
        "code": "... full javascript code string ...",
        "metadata": { ... }
    }
    
    The code should be clean, safe, and modern ES module syntax.
    Do not use markdown formatting (backticks) in the JSON string value, but you can wrap the whole JSON response in a block.`;
  }

  parseGeneratedCode(response, requestedName) {
    try {
      // Strip potential markdown wrapping
      let cleaned = response.replace(/```json/g, '').replace(/```/g, '').trim();
      // Sometimes LLMs add text before/after
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
          cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }
      
      const parsed = JSON.parse(cleaned);
      
      if (requestedName) parsed.arbiterName = requestedName;
      
      return parsed;
    } catch (error) {
      console.error(`[${this.name}] Failed to parse generated code:`, error);
      console.debug(`Raw response: ${response.substring(0, 200)}...`);
      throw new Error('Invalid generated JSON from brain');
    }
  }

  async validateCode(code) {
    // Basic safety checks
    // We allow standard imports but block dangerous system calls
    const dangerousPatterns = [
        /eval\(/, 
        /Function\(/, 
        /child_process/,
        /exec\(/,
        /spawn\(/ 
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return { safe: false, reason: `Dangerous pattern detected: ${pattern}` };
      }
    }
    return { safe: true };
  }

  async storeArbiterVersion(name, code) {
    const version = (this.versionIndex[name] || 0) + 1;
    this.versionIndex[name] = version;

    const fileName = `${name}_v${version}.js`;
    const arbiterPath = path.join(this.arbiterRepoPath, fileName);
    
    await fs.writeFile(arbiterPath, code, 'utf8');
    console.log(`[${this.name}] Stored ${name} v${version} at ${arbiterPath}`);
    
    return arbiterPath;
  }

  async versionControl(arbiterName) {
    try {
        const files = await fs.readdir(this.arbiterRepoPath);
        const versions = files.filter(f => f.startsWith(arbiterName));
        return { success: true, versions };
    } catch (e) {
        return { success: false, versions: [] };
    }
  }

  async selfOptimize() {
    console.log(`[${this.name}] Performing self-optimization...`);
    // Placeholder: In the future, this could analyze failed generations and update the prompt template
    return { success: true, message: "Self-optimization logic placeholder executed." };
  }

  async generateDocumentation(arbiterName) {
    console.log(`[${this.name}] Generating documentation for ${arbiterName}`);
    // Future: Ask the brain to document the code
    return {
      success: true,
      documentation: `Documentation for ${arbiterName}: (Auto-generation pending integration)`
    };
  }
}
