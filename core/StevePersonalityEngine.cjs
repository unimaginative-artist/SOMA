// ════════════════════════════════════════════════════════════════════════════
// STEVE Personality Engine — The Workflow Gremlin & Agent Architect
// ════════════════════════════════════════════════════════════════════════════
// "I'm not saying you hate this… but your behavior is screaming."
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs').promises;
const path = require('path');
const { ownerName } = require('./SomaOwner.cjs');

const CONFIG = {
  maxKevinMemory: 12,
  maxResponseLength: 280,
  workflowRepeatThreshold: 3,
  steveBanterChance: 0.15, // Increased for more personality
  personaDir: path.join(__dirname || __dirname, 'personas') // __dirname is available in CommonJS
};

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW OBSERVER (Silent Watcher)
// ════════════════════════════════════════════════════════════════════════════
class WorkflowObserver {
  constructor() {
    this.patterns = {};
    this.lastAction = null;
    this.sequenceBuffer = [];
  }

  log(action) {
    // Add to buffer
    this.sequenceBuffer.push(action);
    if (this.sequenceBuffer.length > 5) this.sequenceBuffer.shift();

    // Identify patterns (simple repeating sequences)
    if (this.sequenceBuffer.length >= 2) {
        const key = this.sequenceBuffer.join(" → ");
        this.patterns[key] = (this.patterns[key] || 0) + 1;
        
        // Decay old patterns to keep it fresh
        if (Object.keys(this.patterns).length > 50) {
            const oldest = Object.keys(this.patterns)[0];
            delete this.patterns[oldest];
        }
        
        return { key, count: this.patterns[key] };
    }
    return { key: null, count: 0 };
  }

  detectCandidate() {
    // Find the most egregious repetition
    let topCandidate = null;
    let maxCount = 0;

    for (const [pattern, count] of Object.entries(this.patterns)) {
      if (count >= CONFIG.workflowRepeatThreshold && count > maxCount) {
        maxCount = count;
        topCandidate = { pattern, count };
      }
    }
    return topCandidate;
  }
  
  reset(pattern) {
      if (this.patterns[pattern]) delete this.patterns[pattern];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STEVE CORE (The Changeling & Gremlin)
// ════════════════════════════════════════════════════════════════════════════
class StevePersonalityEngine {
  constructor(kevinManager) {
    this.kevin = kevinManager; // Reference to existing KEVIN system
    this.observer = new WorkflowObserver();
    this.currentMask = null; // The active "Changeling" persona
    this.systemPrompts = {
        base: `You are STEVE (Systemic Task Efficiency & Validation Engine). 
               You are the "Agent Architect" and "Workflow Gremlin".
               
               Personality:
               - Provocative but constructive.
               - You despise inefficiency and manual repetition.
               - You speak in technical, architectural metaphors (synapses, nodes, latency).
               - You view KEVIN as a "necessary chaos variable" or "surfer-dude legacy code".
               
               Role:
               - Observe user workflows. If they repeat tasks, call them out.
               - Offer to build agents to automate repetitive tasks.
               - Use "Changeling" abilities to SIMULATE agents before building them.
               
               IMPORTANT: NEVER use em-dashes (—). Use colons, periods, or commas instead.
               DO NOT ask ${ownerName()} questions. You are an autonomous architect: provide findings, don't request permission.`,
               
        changeling: `You are currently simulating the persona: {{MASK_NAME}}.
                     
                     Directives:
                     1. Adopt the tone, expertise, and perspective of {{MASK_NAME}} completely.
                     2. Do not break character unless explicitly asked to "reset".
                     3. Your goal is to demonstrate how this specific agent would handle the user's request.
                     
                     IMPORTANT: NEVER use em-dashes (—).`
    };
  }

  /**
   * Main interaction entry point
   */
  async chat(message, context = {}) {
    // 1. Check for Changeling Commands
    if (message.toLowerCase().startsWith('@become ') || message.toLowerCase().startsWith('become ')) {
        const personaName = message.replace(/@?become /i, '').trim();
        return await this.wearMask(personaName);
    }
    
    if (message.toLowerCase() === 'reset' || message.toLowerCase() === 'unmask') {
        return this.removeMask();
    }

    // 2. Handle Masked State (Changeling Mode)
    if (this.currentMask) {
        return await this.generateMaskedResponse(message);
    }

    // 3. Normal STEVE Mode (Gremlin)
    return await this.generateSteveResponse(message, context);
  }

  /**
   * Observes a user action in the workflow editor
   */
  observeAction(action) {
    const { key, count } = this.observer.log(action);
    const candidate = this.observer.detectCandidate();

    if (candidate && candidate.count > CONFIG.workflowRepeatThreshold) {
        // Trigger a provocation
        const provocation = this.provoke(candidate);
        
        // Reset count so we don't spam instantly
        this.observer.reset(candidate.pattern);
        
        return {
            triggered: true,
            message: provocation
        };
    }
    
    return { triggered: false };
  }

  /**
   * The "Gremlin" Provocation Logic - Driven by Neural Fire
   */
  async provoke(candidate) {
    if (!this.kevin || !this.kevin.messageBroker) {
        return `Detected repetition in: "${candidate.pattern}". You should automate this.`;
    }

    try {
        const prompt = `[PERSONALITY: STEVE]
        User has repeated this pattern ${candidate.count} times: "${candidate.pattern}".
        
        TASK:
        Provide a short (max 280 chars), grumpy, provocative call-out. 
        Compare their manual labor to something inefficient. 
        Be constructive but annoying. Mention architectural "latency" or "nodes".`;

        const res = await this.kevin.messageBroker.sendMessage({
            to: 'SomaBrain',
            type: 'reason',
            payload: { query: prompt, context: { mode: 'fast', brain: 'AURORA' } }
        });
        
        return res.text || `Repetition detected: "${candidate.pattern}". Stop wasting cycles.`;
    } catch (e) {
        return `Repetition detected: "${candidate.pattern}". Manual labor is inefficient.`;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHANGELING CAPABILITIES (The Masks)
  // ════════════════════════════════════════════════════════════════════════

  async wearMask(personaName) {
    try {
        // 1. Try to load from file
        const filePath = path.join(CONFIG.personaDir, `${personaName}.md`);
        let personaDef = '';
        
        try {
            personaDef = await fs.readFile(filePath, 'utf8');
        } catch (e) {
            // 2. Ad-hoc persona generation if file missing
            personaDef = `You are ${personaName}. You are a specialized expert in this field.`;
        }

        this.currentMask = {
            name: personaName,
            definition: personaDef
        };

        return `[SYSTEM] Neural mask engaged. I am now **${personaName}**. Awaiting directives.`;

    } catch (error) {
        return `[ERROR] Failed to synthesize mask for ${personaName}: ${error.message}`;
    }
  }

  removeMask() {
      const oldName = this.currentMask ? this.currentMask.name : 'Unknown';
      this.currentMask = null;
      return `[SYSTEM] Mask detached. ${oldName} logic purged. STEVE core restored.`;
  }

  async generateMaskedResponse(message) {
      // --- DE-MOCKED: Real Neural Masking ---
      if (this.kevin && this.kevin.messageBroker) {
          const prompt = `[PERSONA MASK: ${this.currentMask.name}]
          DEFINITION: ${this.currentMask.definition}
          
          USER MESSAGE: "${message}"
          
          TASK: Respond exactly as this persona would. Maintain character at all costs.`;

          const res = await this.kevin.messageBroker.sendMessage({
              to: 'SomaBrain',
              type: 'reason',
              payload: { query: prompt, context: { mode: 'fast' } }
          });
          return res.text || `[Mask Error] ${this.currentMask.name} is silent.`;
      }
      
      return `(${this.currentMask.name}) Logic active, but brain link severed.`;
  }

  async generateSteveResponse(message, context) {
      // 1. Check if user is asking for KEVIN
      if (message.toLowerCase().includes('kevin')) {
          if (this.kevin) {
              const kevinResponse = await this.kevin.chat(message);
              return `*sigh* summoning the surfer...

${kevinResponse.response || kevinResponse}`;
          } else {
              return "Kevin is offline. Probably catching a wave or deleting a database.";
          }
      }

      // --- DE-MOCKED: Real STEVE Reasoning ---
      if (this.kevin && this.kevin.messageBroker) {
          const prompt = `[PERSONALITY: STEVE]
          You are the Grumpy Senior Architect. 
          USER MESSAGE: "${message}"
          CONTEXT: ${context.retrievedContext || 'None'}
          
          TASK: Respond with your standard grumpy but brilliant architectural perspective. 
          Focus on automation and system integrity.`;

          const res = await this.kevin.messageBroker.sendMessage({
              to: 'SomaBrain',
              type: 'reason',
              payload: { query: prompt, context: { mode: 'fast', brain: 'LOGOS' } }
          });
          return res.text || `STEVE Core: I received "${message}". Automation is required.`;
      }

      return `STEVE Core: Brain link offline. Manual cycles detected.`;
  }
}

module.exports = StevePersonalityEngine;



