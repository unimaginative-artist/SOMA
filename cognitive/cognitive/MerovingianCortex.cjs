// MerovingianCortex.cjs
// Hybrid Merovingian reasoning layer adapted for SOMA architecture
// Integrates with existing BrainAdapter tri-brain system
// VERSION: 1.0.0

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const { BaseArbiter } = require('../core/BaseArbiter.cjs');

const iso = (t = Date.now()) => new Date(t).toISOString();
const mkid = (p = 'mrv') => `${p}_${crypto.randomBytes(6).toString('hex')}`;

// Quick perception layer (from original SLC)
function quickPerception(query) {
  const words = query.toLowerCase().split(/\s+/);
  const len = words.length;
  
  const domainKeywords = {
    medical: ['health', 'disease', 'symptom', 'treatment', 'doctor', 'medicine'],
    technical: ['code', 'function', 'algorithm', 'bug', 'compile', 'deploy'],
    creative: ['story', 'imagine', 'create', 'design', 'art', 'poetry'],
    factual: ['what', 'when', 'where', 'who', 'define', 'explain']
  };
  
  let domain = 'general';
  let maxCount = 0;
  for (const [d, keywords] of Object.entries(domainKeywords)) {
    const count = words.filter(w => keywords.includes(w)).length;
    if (count > maxCount) { maxCount = count; domain = d; }
  }
  
  const novelty_score = Math.min(1.0, len / 50 + Math.random() * 0.2);
  const estimated_risk = domain === 'medical' ? 0.8 : (domain === 'technical' ? 0.3 : 0.1);
  
  return { domain, novelty_score, estimated_risk, queryLength: len };
}

// BrainAdapter from original SLC
class BrainAdapter {
  constructor(name, personality, config) {
    this.name = name;
    this.personality = personality;
    this.apiType = config.type;
    this.endpoint = config.endpoint;
    this.apiKey = config.key;
    this.model = config.model;
  }

  async think(prompt, context = {}) {
    let response;
    try {
      if (this.apiType === 'llama') {
        response = await this.callLlama(prompt, context);
      } else if (this.apiType === 'deepseek') {
        response = await this.callDeepSeek(prompt, context);
      } else if (this.apiType === 'gemini') {
        response = await this.callGemini(prompt, context);
      } else {
        throw new Error(`Unknown API type: ${this.apiType}`);
      }
      return response;
    } catch (error) {
      console.error(`${this.name} error:`, error.message);
      return { text: '', confidence: 0.0, reasoning: `Error: ${error.message}` };
    }
  }

  async callLlama(prompt, context) {
    const http = require('http');
    const payload = JSON.stringify({ model: this.model, prompt, stream: true });
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.endpoint.replace('http://', '').split(':')[0],
        port: parseInt(this.endpoint.split(':')[2]) || 11434,
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const lines = data.trim().split('\n');
            let fullResponse = '';
            for (const line of lines) {
              if (!line) continue;
              const parsed = JSON.parse(line);
              if (parsed.response) fullResponse += parsed.response;
            }
            const confidence = 0.65 + Math.random() * 0.15;
            resolve({ text: fullResponse, confidence, reasoning: 'Ollama creative generation' });
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Ollama timeout')));
      req.write(payload);
      req.end();
    });
  }

  async callDeepSeek(prompt, context) {
    const https = require('https');
    const payload = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: this.personality },
        { role: 'user', content: prompt }
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
        },
        timeout: 30000
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
      req.on('timeout', () => reject(new Error('DeepSeek timeout')));
      req.write(payload);
      req.end();
    });
  }

  async callGemini(prompt, context) {
    const https = require('https');
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: `${this.personality}\n\n${prompt}` }] }],
      generationConfig: {
        temperature: context.phase === 'initial' ? 0.4 : 0.6,
        maxOutputTokens: 1024,
        topP: 0.8
      }
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.candidates && result.candidates[0]) {
              const text = result.candidates[0].content.parts[0].text;
              const confidence = 0.7 + Math.random() * 0.15;
              resolve({ text, confidence, reasoning: 'Gemini analytical reasoning' });
            } else if (result.error) {
              reject(new Error(`Gemini error: ${result.error.message}`));
            } else {
              reject(new Error('No Gemini response'));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Gemini timeout')));
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

// ======================= Merovingian Cortex =======================
class MerovingianCortex extends BaseArbiter {
  constructor(broker, config = {}) {
    super({
      name: config.name || 'MerovingianCortex',
      role: 'hybrid_reasoning_layer',
      capabilities: ['perception', 'parallel_thinking', 'fusion', 'reflection', 'escalation']
    });

    this.broker = broker;
    this.memoryPath = config.memoryPath || path.join(process.cwd(), 'merovingian_provenance');
    this.verbose = config.verbose !== false;
    
    // Load API keys
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
    const LLAMA_ENDPOINT = process.env.LLAMA_ENDPOINT || 'http://localhost:11434'; // Local Ollama for speed!
    
    // Initialize tri-brain system (same as original SLC)
    this.brains = {
      A: new BrainAdapter(
        'BrainA_Prometheus',
        'You are a creative, exploratory AI that generates novel hypotheses and unconventional solutions.',
        { type: 'llama', endpoint: LLAMA_ENDPOINT, model: 'gemma3:4b' }
      ),
      B: new BrainAdapter(
        'BrainB_Aurora',
        'You are Aurora, a synthetic intelligence that explores creative possibilities while maintaining coherence.',
        { type: 'deepseek', key: DEEPSEEK_KEY, model: 'deepseek-chat' }
      ),
      C: new BrainAdapter(
        'BrainC_Logos',
        'You are Logos, an analytical intelligence focused on accuracy, evidence, and logical reasoning.',
        { type: 'gemini', key: GEMINI_KEY, model: 'gemini-2.0-flash-exp' }
      )
    };

    this.config = {
      maxReflection: config.maxReflection || 3,
      finalizeConfidence: config.finalizeConfidence || 0.85,
      escalateConfidence: config.escalateConfidence || 0.70,
      reflectionEnabled: config.reflectionEnabled !== false,
      highRiskDomains: new Set(['medical', 'legal', 'safety']),
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
    this._ensureDir();
  }

  async _ensureDir() {
    try {
      await fs.mkdir(this.memoryPath, { recursive: true });
    } catch (e) {}
  }

  _log(...args) {
    if (this.verbose) console.log('[Merovingian]', ...args);
  }

  async initialize() {
    console.log('🧠 Merovingian: Initializing Hybrid Cortex...');
    console.log(`   Brain A (Prometheus): Creative/Divergent`);
    console.log(`   Brain B (Aurora): Synthetic/Exploratory`);
    console.log(`   Brain C (Logos): Analytical/Convergent`);
    
    // Subscribe to query events
    this.broker.subscribe('slc.query', this.handleQuery.bind(this));
    
    console.log('✅ Merovingian: Cortex online');
  }

  async handleQuery(event) {
    try {
      const result = await this.evaluate(event.query, event.context);
      this.broker.publish('slc.response', { ...event, result });
    } catch (error) {
      console.error('Merovingian query error:', error);
      this.broker.publish('slc.error', { ...event, error: error.message });
    }
  }

  // Main evaluation method (replaces processQuery)
  async evaluate(query, context = {}) {
    const traceId = mkid('mrv');
    const startTime = Date.now();
    
    this._log(`Processing query [${traceId}]`);
    this._log(`Query: ${query.substring(0, 100)}...`);

    // Perception layer
    const meta = quickPerception(query);
    meta.queryLength = meta.queryLength || query.split(/\s+/).length;
    meta.novelty = meta.novelty_score;
    
    this._log(`Perception: domain=${meta.domain}, novelty=${meta.novelty.toFixed(2)}`);
    
    this.metrics.queriesProcessed++;
    this.metrics.domainCounts[meta.domain] = (this.metrics.domainCounts[meta.domain] || 0) + 1;

    // PARALLEL brain calls (key improvement!)
    this._log('Calling all brains in parallel...');
    const [resA, resB, resC] = await Promise.allSettled([
      this.brains.A.think(query, { meta, phase: 'initial' }),
      this.brains.B.think(query, { meta, phase: 'initial' }),
      this.brains.C.think(query, { meta, phase: 'initial' })
    ]);

    const extractResult = (settled, name) => {
      if (settled.status === 'fulfilled') {
        return { source: name, ...settled.value, role: name.toLowerCase() };
      }
      return { source: name + ':error', text: '', confidence: 0.0, role: name.toLowerCase() };
    };

    let candidates = [
      extractResult(resA, 'Prometheus'),
      extractResult(resB, 'Aurora'),
      extractResult(resC, 'Logos')
    ];

    // Initial fusion
    let fused = this._fuseCandidates(candidates, meta);
    this._log(`Initial fusion: confidence=${fused.confidence.toFixed(3)}`);

    // Reflective loop
    let iter = 0;
    while (
      this.config.reflectionEnabled &&
      fused.confidence < this.config.finalizeConfidence &&
      iter < this.config.maxReflection
    ) {
      iter++;
      this._log(`Reflection loop ${iter}...`);
      this.metrics.reflectionLoops++;

      // Parallel critique and expansion
      const [critique, expand] = await Promise.allSettled([
        this.brains.C.critique(fused.text),
        this.brains.A.expand(fused.text)
      ]);

      const crit = critique.status === 'fulfilled' ? critique.value : { text: '', confidence: 0.0 };
      const alt = expand.status === 'fulfilled' ? expand.value : { text: '', confidence: 0.0 };

      candidates.push({ source: 'LogosCritique', ...crit, role: 'logos' });
      candidates.push({ source: 'PrometheusAlt', ...alt, role: 'prometheus' });

      fused = this._fuseCandidates(candidates, meta);
      this._log(`After reflection: confidence=${fused.confidence.toFixed(3)}`);
    }

    // Escalation check
    if (fused.confidence < this.config.escalateConfidence) {
      this._log('Low confidence - escalating to arbiter integration');
      this.metrics.escalations++;

      const arbiterResult = await this.brains.C.think(
        `Integrate and resolve these perspectives:\n${JSON.stringify(candidates.slice(0, 3), null, 2)}`,
        { phase: 'escalation' }
      );

      fused.text = `[Arbiter Integration]\n${arbiterResult.text}`;
      fused.confidence = Math.min(0.95, fused.confidence + 0.15);
    }

    // Safety gating
    if (this.config.highRiskDomains.has(meta.domain) && meta.estimated_risk > 0.8) {
      if (fused.confidence < 0.95) {
        fused.text = `[SAFETY GATE] ${meta.domain} query requires expert validation.\n\n${fused.text}\n\n⚠️ This is AI-generated. Consult professionals.`;
        fused.safety_flagged = true;
      }
    }

    // Update metrics
    this.metrics.avgConfidence = (this.metrics.avgConfidence + fused.confidence) / 2;

    // Persist trace
    const trace = {
      traceId,
      query,
      meta,
      candidates: candidates.map(c => ({
        source: c.source,
        confidence: c.confidence,
        snippet: (c.text || '').substring(0, 150)
      })),
      fused: {
        confidence: fused.confidence,
        bestSource: fused.bestSource
      },
      reflectionLoops: iter,
      escalated: fused.confidence < this.config.escalateConfidence,
      safetyFlagged: fused.safety_flagged || false,
      totalThinkingTime: Date.now() - startTime,
      timestamp: iso()
    };

    const tracePath = await this._persistTrace(trace);

    this._log(`Complete [${traceId}] confidence=${fused.confidence.toFixed(3)} (${Date.now() - startTime}ms)`);

    // Return in original SLC format
    return {
      traceId,
      query,
      meta,
      result: fused.text,
      confidence: fused.confidence,
      provenance: {
        responses: candidates.map(c => ({
          source: c.source,
          confidence: c.confidence,
          snippet: (c.text || '').substring(0, 150)
        })),
        reflectionLoops: iter,
        safetyFlagged: fused.safety_flagged || false,
        tracePath
      },
      totalThinkingTime: Date.now() - startTime,
      timestamp: iso()
    };
  }

  // Weighted fusion (Merovingian algorithm)
  _fuseCandidates(candidates, meta) {
    const novelty = meta.novelty || 0.5;
    
    const roleWeight = (role) => {
      if (!role) return 0.5;
      role = role.toLowerCase();
      if (role.includes('prometheus') || role.includes('deepseek')) return 0.7 * novelty + 0.3;
      if (role.includes('logos') || role.includes('gemini')) return 0.8 * (1 - novelty) + 0.2;
      if (role.includes('aurora')) return 0.6;
      return 0.5;
    };

    const scored = candidates.map(c => {
      const base = roleWeight(c.role || c.source);
      const conf = Math.max(0, Math.min(1, c.confidence || 0));
      const score = base * conf;
      return { c, score };
    });

    const total = scored.reduce((s, x) => s + x.score, 0) || 1;
    scored.forEach(s => s.norm = s.score / total);

    const best = scored.reduce((a, b) => (a.score > b.score ? a : b), scored[0]);
    const fusedConfidence = Math.min(0.995, scored.reduce((s, x) => s + x.norm * (x.c.confidence || 0), 0));

    return {
      text: best.c.text,
      confidence: fusedConfidence,
      bestSource: best.c.source,
      weights: scored.map(s => ({ source: s.c.source, weight: s.norm.toFixed(3) }))
    };
  }

  async _persistTrace(trace) {
    try {
      const filename = `${Date.now()}_${trace.traceId}.json`;
      const filepath = path.join(this.memoryPath, filename);
      await fs.writeFile(filepath, JSON.stringify(trace, null, 2), 'utf8');
      return filepath;
    } catch (e) {
      this._log('Failed to persist trace:', e.message);
      return null;
    }
  }

  // Compatibility with original SLC API
  async processQuery(query, context) {
    return await this.evaluate(query, context);
  }
}

module.exports = MerovingianCortex;
