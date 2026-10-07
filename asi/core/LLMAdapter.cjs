// ═══════════════════════════════════════════════════════════
// FILE: asi/core/LLMAdapter.cjs
// Adapter for different LLM providers (Gemini, Ollama, etc.)
// ═══════════════════════════════════════════════════════════

const fetch = require('node-fetch');

class LLMAdapter {
  constructor(config = {}) {
    this.provider = config.provider || 'gemini'; // gemini, ollama, openai
    this.model = config.model || 'gemini-pro';
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.temperature = config.temperature || 0.7;
    this.maxTokens = config.maxTokens || 2000;
    this.logger = config.logger || console;

    // Set provider-specific defaults
    this._configureProvider();
  }

  _configureProvider() {
    switch (this.provider) {
      case 'gemini':
        if (!this.baseUrl) {
          this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
        }
        if (!this.model) {
          this.model = 'gemini-pro';
        }
        break;

      case 'ollama':
        if (!this.baseUrl) {
          this.baseUrl = 'http://localhost:11434/api';
        }
        if (!this.model) {
          this.model = 'llama2';
        }
        break;

      case 'openai':
        if (!this.baseUrl) {
          this.baseUrl = 'https://api.openai.com/v1';
        }
        if (!this.model) {
          this.model = 'gpt-4';
        }
        break;

      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }

    this.logger.info(`[LLMAdapter] Configured for ${this.provider}`);
    this.logger.info(`  Model: ${this.model}`);
  }

  /**
   * Generate text from prompt
   */
  async generate(prompt, options = {}) {
    const temperature = options.temperature || this.temperature;
    const maxTokens = options.maxTokens || this.maxTokens;

    this.logger.debug(`[LLMAdapter] Generating (${this.provider})...`);

    try {
      switch (this.provider) {
        case 'gemini':
          return await this._generateGemini(prompt, { temperature, maxTokens });

        case 'ollama':
          return await this._generateOllama(prompt, { temperature, maxTokens });

        case 'openai':
          return await this._generateOpenAI(prompt, { temperature, maxTokens });

        default:
          throw new Error(`Provider ${this.provider} not implemented`);
      }
    } catch (error) {
      this.logger.error(`[LLMAdapter] Generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gemini API
   */
  async _generateGemini(prompt, options) {
    if (!this.apiKey) {
      throw new Error('Gemini API key not provided');
    }

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini');
    }

    const text = data.candidates[0].content.parts[0].text;
    return text;
  }

  /**
   * Ollama API
   */
  async _generateOllama(prompt, options) {
    const url = `${this.baseUrl}/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json();
    return data.response;
  }

  /**
   * OpenAI API
   */
  async _generateOpenAI(prompt, options) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not provided');
    }

    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: options.temperature,
        max_tokens: options.maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * Generate multiple completions in parallel
   */
  async generateBatch(prompts, options = {}) {
    this.logger.debug(`[LLMAdapter] Generating batch of ${prompts.length}...`);

    const results = await Promise.all(
      prompts.map(prompt => this.generate(prompt, options))
    );

    return results;
  }

  /**
   * Test connection
   */
  async test() {
    this.logger.info(`[LLMAdapter] Testing connection to ${this.provider}...`);

    try {
      const response = await this.generate('Say "Hello from ASI!"', { maxTokens: 50 });
      this.logger.info(`  Response: ${response.substring(0, 100)}...`);
      return { success: true, response };
    } catch (error) {
      this.logger.error(`  Test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = LLMAdapter;
