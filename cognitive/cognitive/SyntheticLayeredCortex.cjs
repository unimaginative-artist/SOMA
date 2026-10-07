// SyntheticLayeredCortex.cjs - Multi-brain thinking layer for SOMA
// Implements: Brain A (Divergent), Brain B (Convergent), Brain C (Arbiter)
const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const { getEnvLoader } = require('../config/EnvLoader.cjs');
const { QueryRouter } = require('./QueryRouter.cjs');
const crypto = require('crypto');
const EventEmitter = require('events');

const genId = () => crypto.randomBytes(4).toString('hex');
const iso = () => new Date().toISOString();

// ======================= Perception (Sensory Cortex) =======================
function quickPerception(query) {
  const txt = (query || '').toLowerCase();
  const novelty_score = Math.min(1, Math.max(0, txt.split(' ').length / 20));
  
  // Domain detection
  const medicalKws = ['cancer', 'disease', 'treatment', 'diagnosis', 'surgery', 'medical'];
  const technicalKws = ['code', 'algorithm', 'function', 'debug', 'error', 'programming'];
  const creativeKws = ['story', 'imagine', 'creative', 'design', 'art', 'brainstorm'];
  
  let domain = 'general';
  let estimated_risk = 0.1;
  
  if (medicalKws.some(k => txt.includes(k))) {
    domain = 'medical';
    estimated_risk = 0.9;
  } else if (technicalKws.some(k => txt.includes(k))) {
    domain = 'technical';
    estimated_risk = 0.2;
  } else if (creativeKws.some(k => txt.includes(k))) {
    domain = 'creative';
    estimated_risk = 0.1;
  }
  
  return {
    novelty_score,
    domain,
    estimated_risk,
    length: txt.split(' ').length,
    complexity: novelty_score * (txt.length / 100)
  };
}

// ======================= Brain Adapters =======================
class BrainAdapter {
  constructor(name, personality, apiConfig = {}) {
    this.name = name;
    this.personality = personality;
    
    // Load API config from environment or use provided override
    const envLoader = getEnvLoader();
    let providerConfig;
    
    if (apiConfig.type) {
      // Use explicitly provided type
      providerConfig = envLoader.getProvider(apiConfig.type);
    } else {
      // Auto-detect best available provider
      providerConfig = envLoader.getApiProvider();
    }
    
    this.apiType = providerConfig.type;
    this.apiKey = apiConfig.key || providerConfig.apiKey;
    this.endpoint = apiConfig.endpoint || providerConfig.endpoint;
    this.model = apiConfig.model || providerConfig.model || 'default';
    
    console.log(`🧠 ${this.name} initialized with ${this.apiType} (model: ${this.model})`);
  }

  async think(prompt, context = {}) {
    const startTime = Date.now();
    
    // PRODUCTION: No fallback simulation - require explicit API configuration
    if (!this.apiType) {
      throw new Error(`BrainAdapter "${this.name}" requires explicit apiType configuration (openai|gemini|deepseek|ollama). Simulation mode is not supported.`);
    }
    
    try {
      let response;
      
      if (this.apiType === 'openai') {
        response = await this.callOpenAI(prompt, context);
      } else if (this.apiType === 'ollama') {
        response = await this.callOllama(prompt, context);
      } else if (this.apiType === 'deepseek') {
        response = await this.callDeepSeek(prompt, context);
      } else if (this.apiType === 'gemini') {
        response = await this.callGemini(prompt, context);
      } else {
        throw new Error(`Unsupported apiType: ${this.apiType}. Must be one of: openai|gemini|deepseek|ollama`);
      }
      
      response.timestamp = iso();
      response.thinkingTime = Date.now() - startTime;
      return response;
      
    } catch (error) {
      console.error(`${this.name} API error:`, error.message);
      return {
        text: `[${this.name} - ERROR] Unable to process. ${error.message}`,
        confidence: 0.1,
        error: error.message,
        timestamp: iso(),
        thinkingTime: Date.now() - startTime
      };
    }
  }

  async callOpenAI(prompt, context) {
    const https = require('https');
    
    const payload = JSON.stringify({
      model: this.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: this.personality
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: context.phase === 'initial' ? 0.9 : 0.7,
      max_tokens: 2048,
      top_p: 0.95
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.choices && result.choices[0]) {
              const text = result.choices[0].message.content;
              const confidence = 0.75 + (result.choices[0].finish_reason === 'stop' ? 0.2 : 0);
              resolve({ text, confidence, reasoning: 'OpenAI GPT analytical reasoning' });
            } else if (result.error) {
              reject(new Error(`OpenAI API error: ${result.error.message || JSON.stringify(result.error)}`));
            } else {
              reject(new Error('No response from OpenAI'));
            }
          } catch (e) {
            reject(new Error(`OpenAI parse error: ${e.message}. Response: ${data.substring(0, 200)}...`));
          }
        });
      });
      
      req.on('error', (e) => {
        reject(new Error(`OpenAI HTTP error: ${e.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OpenAI request timeout'));
      });
      
      req.setTimeout(30000);
      req.write(payload);
      req.end();
    });
  }

  async callOllama(prompt, context) {
    const http = require('http');
    const { URL } = require('url');
    
    // Parse endpoint: could be http://localhost:11434 or with trailing slash
    let baseUrl = this.endpoint;
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    
    const url = new URL('api/generate', baseUrl);
    const fullPrompt = `${this.personality}\n\nUser: ${prompt}\n\nAssistant:`;
    
    // Normalize model name: strip quantization suffix if present (e.g., 'llama3.2:8b' -> 'llama3.2')
    const modelName = this.model.split(':')[0] || 'llama3.2';
    
    const payload = JSON.stringify({
      model: modelName,
      prompt: fullPrompt,
      stream: false,
      temperature: context.phase === 'initial' ? 1.2 : 0.9,
      num_predict: 512,  // Reduced from 2048 for faster responses
      top_p: 0.9,
      top_k: 40
    });

    return new Promise((resolve, reject) => {
      const hostname = url.hostname;
      const port = url.port ? parseInt(url.port, 10) : 11434;
      const path = url.pathname;
      
      const options = {
        hostname,
        port,
        path,
        method: 'POST',
        timeout: 60000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      
      let responseData = '';
      
      const req = http.request(options, (res) => {
        res.on('data', chunk => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            
            // Ollama returns { response, model, created_at, done, ... }
            if (result.response && result.done === true) {
              const text = result.response.trim();
              if (!text) {
                reject(new Error('Ollama returned empty response'));
                return;
              }
              const confidence = 0.7 + (result.eval_count && result.prompt_eval_count ? 0.15 : 0);
              resolve({ text, confidence, reasoning: 'Ollama local model generation' });
            } else if (result.error) {
              reject(new Error(`Ollama error: ${result.error}`));
            } else {
              reject(new Error(`Ollama incomplete response. Keys: ${Object.keys(result).join(', ')}. Done: ${result.done}`));
            }
          } catch (e) {
            reject(new Error(`Ollama JSON parse error: ${e.message}. Data: ${responseData.substring(0, 300)}...`));
          }
        });
      });
      
      req.on('error', (e) => {
        reject(new Error(`Ollama connection error to ${hostname}:${port}: ${e.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Ollama request timeout (60s) to ${hostname}:${port}`));
      });
      
      req.write(payload);
      req.end();
    });
  }

  async callGemini(prompt, context) {
    const https = require('https');
    const { URL } = require('url');
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;
    const parsedUrl = new URL(apiUrl);
    
    const payload = JSON.stringify({
      contents: [{
        parts: [{
          text: `${this.personality}\n\n${prompt}`
        }]
      }],
      generationConfig: {
        temperature: context.phase === 'initial' ? 0.3 : 0.5,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024
      }
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.candidates && result.candidates[0]) {
              const text = result.candidates[0].content.parts[0].text;
              const confidence = 0.7 + (result.candidates[0].finishReason === 'STOP' ? 0.2 : 0);
              resolve({ text, confidence, reasoning: 'Gemini analytical reasoning' });
            } else if (result.error) {
              reject(new Error(`Gemini: ${result.error.message}`));
            } else {
              reject(new Error('No response from Gemini'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async callDeepSeek(prompt, context) {
    const https = require('https');
    
    const payload = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: this.personality
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: context.phase === 'initial' ? 1.0 : 0.8,
      max_tokens: 1024,
      top_p: 0.95
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.deepseek.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.choices && result.choices[0]) {
              const text = result.choices[0].message.content;
              const confidence = 0.6 + (result.choices[0].finish_reason === 'stop' ? 0.2 : 0);
              resolve({ text, confidence, reasoning: 'DeepSeek creative exploration' });
            } else if (result.error) {
              reject(new Error(`DeepSeek API error: ${result.error.message}`));
            } else {
              reject(new Error('No response from DeepSeek'));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async critique(text) {
    return await this.think(`Critique and improve: ${text}`);
  }

  async expand(text) {
    return await this.think(`Explore alternatives to: ${text}`);
  }
}

// ======================= Synthetic Layered Cortex =======================
class SyntheticLayeredCortex extends BaseArbiter {
  constructor(broker, config = {}) {
    super({
      name: config.name || 'SyntheticLayeredCortex',
      role: 'thinking_layer',
      capabilities: ['perception', 'divergent_thinking', 'convergent_thinking', 'integration', 'reflection']
    });

    this.broker = broker;
    
    // Initialize QueryRouter for dynamic progressive routing based on query complexity
    this.queryRouter = new QueryRouter(config);
    
    // Load API configuration from environment via EnvLoader
    const envLoader = getEnvLoader();
    const providers = envLoader.getAvailableProviders();
    
    // Initialize tri-brain system with available providers (fallback priority: openai/gemini/deepseek/ollama)
    // These are now used as fallbacks; primary routing happens via QueryRouter
    this.brains = {
      // Brain A: Creative/Divergent thinking - use best available provider
      A: new BrainAdapter(
        'BrainA_Prometheus', 
        'You are a creative, exploratory AI that generates novel hypotheses and unconventional solutions. Think divergently and imaginatively.',
        { type: providers[0]?.type || 'ollama' }
      ),
      
      // Brain B: Synthesis - use second-best or fallback
      B: new BrainAdapter(
        'BrainB_Aurora',
        'You are Aurora, a synthetic intelligence that explores creative possibilities while maintaining coherence. Generate innovative yet grounded ideas.',
        { type: providers[1]?.type || providers[0]?.type || 'ollama' }
      ),
      
      // Brain C: Analytical - use third-best or fallback
      C: new BrainAdapter(
        'BrainC_Logos',
        'You are Logos, an analytical intelligence focused on accuracy, evidence, and logical reasoning. Provide factual, well-reasoned responses.',
        { type: providers[2]?.type || providers[0]?.type || 'ollama' }
      )
    };

    this.config = {
      routerMaxIter: config.routerMaxIter || 3,
      confidenceFinalize: config.confidenceFinalize || 0.85,
      confidenceEscalate: config.confidenceEscalate || 0.70,
      reflectionEnabled: config.reflectionEnabled !== false,
      ...config
    };

    this.metrics = {
      queriesProcessed: 0,
      reflectionLoops: 0,
      escalations: 0,
      avgConfidence: 0,
      domainCounts: {}
    };

    this.thoughtHistory = [];
  }

  async initialize() {
    console.log('🧠 SLC: Initializing Synthetic Layered Cortex...');
    console.log(`   Brain A: ${this.brains.A.personality}`);
    console.log(`   Brain B: ${this.brains.B.personality}`);
    console.log(`   Brain C: ${this.brains.C.personality}`);
    console.log(`\n   ✨ QueryRouter: Cost-optimized progressive escalation enabled`);
    console.log(`      Simple queries → Ollama (free)`);
    console.log(`      Complex queries → DeepSeek (paid)`);
    console.log(`      Very complex → Gemini (free-tier)`);
    console.log(`      Impossible → OpenAI (premium)`);
    
    // Subscribe to query events
    if (this.broker) {
      this.broker.subscribe('slc.query', this.handleQuery.bind(this));
      this.broker.subscribe('slc.reflect', this.handleReflection.bind(this));
    }
    
    console.log('✅ SLC: Cortex online');
  }

  /**
   * Select provider for a query based on complexity
   * Uses QueryRouter for cost optimization
   */
  selectProviderForQuery(query) {
    const routing = this.queryRouter.selectProvider(query, { preferCost: 'minimize' });
    return routing.provider;
  }

  /**
   * Get routing explanation and metrics
   */
  getRoutingStrategy() {
    return this.queryRouter.explainStrategy();
  }

  /**
   * Get query routing metrics
   */
  getRoutingMetrics() {
    return this.queryRouter.getMetrics();
  }

  async handleQuery(event) {
    try {
      const result = await this.processQuery(event.query, event.context);
      this.broker.publish('slc.response', { ...event, result });
    } catch (error) {
      console.error('SLC query error:', error);
      this.broker.publish('slc.error', { ...event, error: error.message });
    }
  }

  async handleReflection(event) {
    const reflection = await this.reflect(event.thoughts);
    this.broker.publish('slc.reflection_complete', { ...event, reflection });
  }

  async processQuery(query, context = {}) {
    const traceId = genId();
    console.log(`\n🧠 SLC: Processing query [${traceId}]`);
    console.log(`   Query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}`);

    // PERCEPTION LAYER
    const meta = quickPerception(query);
    console.log(`   📊 Perception: domain=${meta.domain}, novelty=${meta.novelty_score.toFixed(2)}, risk=${meta.estimated_risk.toFixed(2)}`);
    
    this.metrics.queriesProcessed++;
    this.metrics.domainCounts[meta.domain] = (this.metrics.domainCounts[meta.domain] || 0) + 1;

    // INITIAL BRAIN SELECTION
    const responses = [];
    
    if (meta.domain === 'creative' || meta.novelty_score > 0.7) {
      // High novelty: Divergent first
      console.log('   🎨 Route: Divergent → Convergent');
      responses.push({
        source: 'BrainA',
        ...(await this.brains.A.think(query, { meta, phase: 'initial' }))
      });
      responses.push({
        source: 'BrainB',
        ...(await this.brains.B.think(query, { meta, phase: 'initial' }))
      });
    } else {
      // Low novelty or factual: Convergent first
      console.log('   📚 Route: Convergent → Divergent');
      responses.push({
        source: 'BrainB',
        ...(await this.brains.B.think(query, { meta, phase: 'initial' }))
      });
      responses.push({
        source: 'BrainA',
        ...(await this.brains.A.think(query, { meta, phase: 'initial' }))
      });
    }

    // FUSION
    let fused = this.fuseResponses(responses, meta);
    console.log(`   🔀 Initial fusion: confidence=${fused.confidence.toFixed(3)}`);

    // REFLECTIVE LOOPS
    let iters = 0;
    while (
      this.config.reflectionEnabled &&
      fused.confidence < this.config.confidenceFinalize &&
      iters < this.config.routerMaxIter
    ) {
      console.log(`   🔄 Reflection loop ${iters + 1}...`);
      this.metrics.reflectionLoops++;

      const critiques = await Promise.all([
        this.brains.B.critique(fused.text),
        this.brains.A.expand(fused.text)
      ]);

      responses.push(
        { source: 'BrainB_critique', ...critiques[0] },
        { source: 'BrainA_expand', ...critiques[1] }
      );

      fused = this.fuseResponses(responses, meta);
      console.log(`      → confidence=${fused.confidence.toFixed(3)}`);
      iters++;
    }

    // ESCALATION CHECK
    if (fused.confidence < this.config.confidenceEscalate) {
      console.log(`   ⚠️  Low confidence - escalating to arbiter brain`);
      this.metrics.escalations++;
      
      const arbiterInput = {
        query,
        candidates: responses,
        meta,
        fused
      };
      
      const arbiterResponse = await this.brains.C.think(
        `Integrate and resolve: ${JSON.stringify(arbiterInput, null, 2)}`,
        { phase: 'escalation' }
      );
      
      fused.text = `[Arbiter Integration]\n${arbiterResponse.text}`;
      fused.confidence = Math.min(0.95, fused.confidence + 0.15);
    }

    // SAFETY GATING
    if (meta.domain === 'medical' && meta.estimated_risk > 0.8) {
      if (fused.confidence < 0.95) {
        fused.text = `[SAFETY GATE] Medical query requires expert validation.\n\n${fused.text}\n\n⚠️ This is AI-generated information. Consult healthcare professionals.`;
        fused.safety_flagged = true;
      }
    }

    // Update metrics
    this.metrics.avgConfidence = (this.metrics.avgConfidence + fused.confidence) / 2;

    // Store in history
    const thought = {
      traceId,
      query,
      meta,
      responses: responses.length,
      reflectionLoops: iters,
      finalConfidence: fused.confidence,
      timestamp: iso()
    };
    this.thoughtHistory.push(thought);
    if (this.thoughtHistory.length > 1000) this.thoughtHistory.shift();

    console.log(`✅ SLC: Complete [${traceId}] confidence=${fused.confidence.toFixed(3)}\n`);

    return {
      traceId,
      query,
      meta,
      result: fused.text,
      confidence: fused.confidence,
      provenance: {
        responses: responses.map(r => ({
          source: r.source,
          confidence: r.confidence,
          snippet: r.text.substring(0, 150)
        })),
        reflectionLoops: iters,
        safetyFlagged: fused.safety_flagged
      },
      timestamp: iso()
    };
  }

  fuseResponses(responses, meta) {
    const novelty = meta.novelty_score || 0.5;
    
    // Weight responses based on source and domain
    const weights = responses.map(r => {
      let weight = 1.0;
      
      if (r.source.includes('BrainA')) {
        // Divergent brain - higher weight for creative/novel queries
        weight = 0.3 + (0.7 * novelty);
      } else if (r.source.includes('BrainB')) {
        // Convergent brain - higher weight for factual queries
        weight = 0.3 + (0.7 * (1 - novelty));
      } else if (r.source.includes('BrainC')) {
        // Arbiter brain - consistent weight
        weight = 0.8;
      }
      
      // Multiply by confidence
      return weight * (r.confidence || 0.1);
    });

    const wsum = weights.reduce((s, w) => s + w, 0) || 1;
    const normalized = weights.map(w => w / wsum);

    // Select best by weighted score
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < responses.length; i++) {
      const score = normalized[i] * (responses[i].confidence || 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const best = responses[bestIndex];
    const weightedConfidence = responses.reduce(
      (sum, r, i) => sum + normalized[i] * (r.confidence || 0),
      0
    );

    return {
      text: best.text,
      confidence: Math.min(0.99, weightedConfidence),
      bestSource: best.source,
      weights: Object.fromEntries(responses.map((r, i) => [r.source, normalized[i].toFixed(3)]))
    };
  }

  async reflect(thoughts) {
    // Meta-reflection on recent thought patterns
    const recent = this.thoughtHistory.slice(-10);
    const avgConf = recent.reduce((s, t) => s + t.finalConfidence, 0) / (recent.length || 1);
    const domainDist = {};
    recent.forEach(t => {
      domainDist[t.meta.domain] = (domainDist[t.meta.domain] || 0) + 1;
    });

    return {
      recentQueries: recent.length,
      avgConfidence: avgConf.toFixed(3),
      domainDistribution: domainDist,
      totalReflectionLoops: this.metrics.reflectionLoops,
      timestamp: iso()
    };
  }

  getStatus() {
    return {
      name: this.name,
      brains: Object.keys(this.brains),
      metrics: this.metrics,
      config: this.config,
      historySize: this.thoughtHistory.length
    };
  }
}

module.exports = SyntheticLayeredCortex;
