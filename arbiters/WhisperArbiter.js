/**
 * WHISPER AUDIO PROCESSING ARBITER
 * Inspired by Autogen's Whisper audio example
 *
 * Capabilities:
 * - Audio transcription (speech to text)
 * - Audio translation (any language → English)
 * - Voice input processing for SOMA
 * - Meeting transcription
 * - Multi-language support
 *
 * Uses OpenAI Whisper API
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';

export default class WhisperArbiter extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'WhisperArbiter';

    // Configuration
    this.config = {
      apiKey: opts.apiKey || process.env.OPENAI_API_KEY,
      model: opts.model || 'whisper-1',
      defaultLanguage: opts.defaultLanguage || 'en', // For translation
      maxFileSize: opts.maxFileSize || 25 * 1024 * 1024, // 25MB (Whisper limit)
      supportedFormats: opts.supportedFormats || [
        'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'
      ],
      tempDir: opts.tempDir || path.join(process.cwd(), 'SOMA', 'audio-temp')
    };

    // OpenAI client
    this.openai = null;
    this.initialized = false;

    // Metrics
    this.metrics = {
      transcriptions: 0,
      translations: 0,
      totalDuration: 0,
      totalSize: 0,
      avgProcessingTime: 0,
      errors: 0
    };
  }

  // ===========================
  // Initialization
  // ===========================

  async initialize() {
    try {
      console.log(`[${this.name}] 🎤 Initializing Whisper Audio Processing...`);

      // Check API key
      if (!this.config.apiKey) {
        throw new Error('OPENAI_API_KEY not set');
      }

      // Initialize OpenAI client
      this.openai = new OpenAI({
        apiKey: this.config.apiKey
      });

      // Ensure temp directory exists
      try {
        await fs.mkdir(this.config.tempDir, { recursive: true });
      } catch (e) {
        // Directory already exists
      }

      this.initialized = true;
      console.log(`[${this.name}] ✅ Whisper ready (model: ${this.config.model})`);
      console.log(`[${this.name}]    Supported formats: ${this.config.supportedFormats.join(', ')}`);

      this.emit('initialized');
    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error.message);
      throw error;
    }
  }

  // ===========================
  // Core Audio Processing
  // ===========================

  /**
   * Transcribe audio file to text
   * @param {string|Buffer} audioInput - File path or buffer
   * @param {Object} options - Transcription options
   * @returns {Object} Transcription result
   */
  async transcribe(audioInput, options = {}) {
    const startTime = Date.now();

    try {
      if (!this.initialized) {
        throw new Error('WhisperArbiter not initialized');
      }

      // Validate and prepare audio file
      const audioFile = await this._prepareAudioFile(audioInput);

      console.log(`[${this.name}] 🎤 Transcribing audio...`);

      // Call Whisper API
      const response = await this.openai.audio.transcriptions.create({
        file: createReadStream(audioFile.path),
        model: this.config.model,
        language: options.language || undefined, // Auto-detect if not specified
        prompt: options.prompt || undefined, // Optional context
        response_format: options.format || 'json', // json, text, srt, vtt, verbose_json
        temperature: options.temperature || 0
      });

      const duration = Date.now() - startTime;

      // Update metrics
      this.metrics.transcriptions++;
      this.metrics.totalSize += audioFile.size;
      this.metrics.avgProcessingTime =
        (this.metrics.avgProcessingTime * (this.metrics.transcriptions - 1) + duration) /
        this.metrics.transcriptions;

      // Cleanup temp file if we created it
      if (audioFile.isTemp) {
        await fs.unlink(audioFile.path).catch(() => {});
      }

      console.log(`[${this.name}] ✅ Transcription complete (${duration}ms)`);
      const transcribedText = typeof response === 'string' ? response : response.text;
      
      const broker = global.__SOMA_SYSTEM?.messageBroker || global.SOMA_COS?.messageBroker;
      if (broker && transcribedText) {
        broker.publish('user_voice_command', { text: transcribedText, source: 'whisper' });
      }

      this.emit('transcription_complete', {
        duration,
        size: audioFile.size,
        text: transcribedText,
        textLength: transcribedText?.length || 0
      });

      return {
        success: true,
        text: response.text,
        language: options.language || 'auto',
        duration,
        metadata: {
          model: this.config.model,
          format: audioFile.format,
          size: audioFile.size
        }
      };

    } catch (error) {
      this.metrics.errors++;
      console.error(`[${this.name}] ❌ Transcription failed:`, error.message);

      this.emit('transcription_error', {
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Translate audio to English
   * @param {string|Buffer} audioInput - File path or buffer
   * @param {Object} options - Translation options
   * @returns {Object} Translation result
   */
  async translate(audioInput, options = {}) {
    const startTime = Date.now();

    try {
      if (!this.initialized) {
        throw new Error('WhisperArbiter not initialized');
      }

      // Validate and prepare audio file
      const audioFile = await this._prepareAudioFile(audioInput);

      console.log(`[${this.name}] 🌍 Translating audio to English...`);

      // Call Whisper API (translation endpoint)
      const response = await this.openai.audio.translations.create({
        file: createReadStream(audioFile.path),
        model: this.config.model,
        prompt: options.prompt || undefined,
        response_format: options.format || 'json',
        temperature: options.temperature || 0
      });

      const duration = Date.now() - startTime;

      // Update metrics
      this.metrics.translations++;
      this.metrics.totalSize += audioFile.size;

      // Cleanup temp file if we created it
      if (audioFile.isTemp) {
        await fs.unlink(audioFile.path).catch(() => {});
      }

      console.log(`[${this.name}] ✅ Translation complete (${duration}ms)`);

      this.emit('translation_complete', {
        duration,
        size: audioFile.size,
        textLength: response.text.length
      });

      return {
        success: true,
        text: response.text,
        sourceLanguage: 'auto-detected',
        targetLanguage: 'en',
        duration,
        metadata: {
          model: this.config.model,
          format: audioFile.format,
          size: audioFile.size
        }
      };

    } catch (error) {
      this.metrics.errors++;
      console.error(`[${this.name}] ❌ Translation failed:`, error.message);

      this.emit('translation_error', {
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Process voice command - transcribe and optionally route to SOMA
   * @param {string|Buffer} audioInput - Voice command audio
   * @param {Object} options - Processing options
   * @returns {Object} Processed command
   */
  async processVoiceCommand(audioInput, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`[${this.name}] 🗣️  Processing voice command...`);

      // Transcribe the audio
      const transcription = await this.transcribe(audioInput, {
        language: options.language,
        prompt: options.context || 'Voice command for SOMA AI system.'
      });

      const command = transcription.text.trim();

      // Emit for SOMA routing
      this.emit('voice_command', {
        command,
        duration: Date.now() - startTime,
        language: options.language || 'auto'
      });

      console.log(`[${this.name}] ✅ Voice command processed: "${command.substring(0, 50)}..."`);

      return {
        success: true,
        command,
        originalAudio: audioInput,
        processingTime: Date.now() - startTime,
        metadata: transcription.metadata
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ Voice command processing failed:`, error.message);
      throw error;
    }
  }

  // ===========================
  // Helper Methods
  // ===========================

  /**
   * Validate and prepare audio file for processing
   * @private
   */
  async _prepareAudioFile(input) {
    try {
      let filePath;
      let isTemp = false;
      let size;

      // Handle buffer input
      if (Buffer.isBuffer(input)) {
        const tempFile = path.join(
          this.config.tempDir,
          `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`
        );
        await fs.writeFile(tempFile, input);
        filePath = tempFile;
        isTemp = true;
        size = input.length;
      }
      // Handle file path input
      else if (typeof input === 'string') {
        filePath = input;
        const stats = await fs.stat(filePath);
        size = stats.size;
      }
      else {
        throw new Error('Invalid audio input type. Must be file path (string) or Buffer.');
      }

      // Check file size
      if (size > this.config.maxFileSize) {
        throw new Error(`File size ${size} exceeds maximum ${this.config.maxFileSize} bytes`);
      }

      // Check format
      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (!this.config.supportedFormats.includes(ext)) {
        throw new Error(`Unsupported format: ${ext}. Supported: ${this.config.supportedFormats.join(', ')}`);
      }

      return {
        path: filePath,
        format: ext,
        size,
        isTemp
      };

    } catch (error) {
      throw new Error(`Audio file preparation failed: ${error.message}`);
    }
  }

  // ===========================
  // Utility Methods
  // ===========================

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      avgFileSizeMB: (this.metrics.totalSize / (1024 * 1024)).toFixed(2),
      successRate: this.metrics.transcriptions + this.metrics.translations > 0
        ? ((this.metrics.transcriptions + this.metrics.translations - this.metrics.errors) /
           (this.metrics.transcriptions + this.metrics.translations) * 100).toFixed(2) + '%'
        : 'N/A'
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      transcriptions: 0,
      translations: 0,
      totalDuration: 0,
      totalSize: 0,
      avgProcessingTime: 0,
      errors: 0
    };
    console.log(`[${this.name}] Metrics reset`);
  }

  /**
   * Cleanup temp directory
   */
  async cleanup() {
    try {
      const files = await fs.readdir(this.config.tempDir);
      for (const file of files) {
        await fs.unlink(path.join(this.config.tempDir, file));
      }
      console.log(`[${this.name}] Temp directory cleaned (${files.length} files removed)`);
    } catch (error) {
      console.warn(`[${this.name}] Cleanup warning:`, error.message);
    }
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    await this.cleanup();
    this.initialized = false;
    this.emit('shutdown');
  }
}
