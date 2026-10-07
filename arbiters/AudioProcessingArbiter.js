// ════════════════════════════════════════════════════════════════════════════
// AudioProcessingArbiter — Multi-Modal Audio Intelligence
// ════════════════════════════════════════════════════════════════════════════
// PURPOSE: Speech-to-text, audio classification, and multi-modal audio reasoning
// APPROACH: Start simple (file-based), avoid streaming hell, use Whisper API
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

class AudioProcessingArbiter extends BaseArbiter {
  static role = 'audio-processing';
  static capabilities = [
    'transcribe-speech',
    'detect-speaker',
    'classify-audio',
    'audio-embeddings',
    'detect-audio-events',
    'sentiment-from-voice',
    'audio-vision-fusion'
  ];

  constructor(id, config = {}) {
    super(id, config);

    this.name = 'AudioProcessingArbiter';
    this.config = {
      // Local Whisper Flask server (primary - free, fast, private)
      localWhisperUrl: config.localWhisperUrl || process.env.WHISPER_LOCAL_URL || 'http://localhost:5002',
      preferLocal: config.preferLocal !== false, // Default: prefer local
      // OpenAI Whisper API (fallback - better accuracy)
      whisperApiKey: config.whisperApiKey || process.env.OPENAI_API_KEY,
      whisperModel: config.whisperModel || 'whisper-1',
      maxFileSizeMB: config.maxFileSizeMB || 25, // Whisper API limit
      supportedFormats: config.supportedFormats || ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'],
      language: config.language || null, // Auto-detect if null
      enableTimestamps: config.enableTimestamps !== false,
      enableSpeakerDetection: config.enableSpeakerDetection || false,
      audioStoragePath: config.audioStoragePath || path.join(__dirname, '../data/audio'),
      ...config
    };

    // Track local Whisper availability
    this.localWhisperAvailable = false;

    // Transcription cache: audioHash -> transcript
    this.transcriptionCache = new Map();

    // Audio metadata: audioPath -> metadata
    this.audioMetadata = new Map();

    // Statistics
    this.stats = {
      transcriptionsCompleted: 0,
      localTranscriptions: 0,
      cloudTranscriptions: 0,
      totalAudioDurationSeconds: 0,
      errorsEncountered: 0,
      cacheHits: 0,
      averageProcessingTime: 0
    };

    // Log routing strategy
    const hasCloudKey = !!this.config.whisperApiKey;
    console.log(`[${this.name}] Initialized with config:`, {
      localWhisper: this.config.localWhisperUrl,
      preferLocal: this.config.preferLocal,
      cloudFallback: hasCloudKey ? 'enabled' : 'disabled (no OPENAI_API_KEY)',
      model: this.config.whisperModel,
      maxSize: `${this.config.maxFileSizeMB}MB`,
      formats: this.config.supportedFormats.length,
      timestamps: this.config.enableTimestamps
    });

    if (!hasCloudKey && !this.config.preferLocal) {
      console.warn(`[${this.name}] ⚠️  No OPENAI_API_KEY and local not preferred — transcription may fail.`);
    }
  }

  /**
   * Lifecycle: Activate arbiter
   */
  async onActivate() {
    console.log(`[${this.name}] 🎤 Activating Audio Processing system...`);

    // Ensure audio storage directory exists
    try {
      await fs.mkdir(this.config.audioStoragePath, { recursive: true });
      console.log(`[${this.name}] 📁 Audio storage ready: ${this.config.audioStoragePath}`);
    } catch (error) {
      console.warn(`[${this.name}] ⚠️  Could not create audio storage:`, error.message);
    }

    // Check local Whisper server health
    await this.checkLocalWhisperHealth();

    // Subscribe to audio events
    this.subscribeToEvents();

    console.log(`[${this.name}] ✅ Audio Processing active`);
  }

  /**
   * Subscribe to relevant events
   */
  subscribeToEvents() {
    const events = [
      'audio_received',
      'transcription_requested',
      'audio_classification_requested',
      'speaker_detection_requested'
    ];

    for (const event of events) {
      messageBroker.subscribe(this.name, event);
    }

    // Handle audio processing requests
    messageBroker.on('transcription_requested', async (msg) => {
      await this.handleTranscriptionRequest(msg.payload);
    });

    messageBroker.on('audio_received', async (msg) => {
      await this.handleAudioReceived(msg.payload);
    });

    console.log(`[${this.name}] 📡 Subscribed to ${events.length} audio events`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEECH TRANSCRIPTION (Core Feature)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transcribe audio file to text using Whisper API
   *
   * @param {string} audioPath - Path to audio file
   * @param {object} options - Transcription options
   * @returns {object} Transcription result
   */
  async transcribeSpeech(audioPath, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`[${this.name}] 🎙️  Transcribing: ${path.basename(audioPath)}`);

      // Validate file exists
      const fileExists = await this.fileExists(audioPath);
      if (!fileExists) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      // Check file size
      const stats = await fs.stat(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > this.config.maxFileSizeMB) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB (max: ${this.config.maxFileSizeMB}MB)`);
      }

      // Check format
      const ext = path.extname(audioPath).toLowerCase().replace('.', '');
      if (!this.config.supportedFormats.includes(ext)) {
        throw new Error(`Unsupported format: .${ext} (supported: ${this.config.supportedFormats.join(', ')})`);
      }

      // Check cache first
      const fileHash = await this.getFileHash(audioPath);
      if (this.transcriptionCache.has(fileHash)) {
        console.log(`[${this.name}] 💾 Cache hit for ${path.basename(audioPath)}`);
        this.stats.cacheHits++;
        return this.transcriptionCache.get(fileHash);
      }

      // Hybrid transcription: local first, cloud fallback
      const transcript = await this.transcribeWithFallback(audioPath, options);

      // Extract metadata
      const metadata = {
        duration: transcript.duration || null,
        language: transcript.language || options.language || 'unknown',
        segments: transcript.segments || [],
        words: transcript.words || []
      };

      // Build result
      const result = {
        success: true,
        text: transcript.text,
        metadata,
        audioPath,
        fileSizeMB: fileSizeMB.toFixed(2),
        processingTimeMs: Date.now() - startTime
      };

      // Cache result
      this.transcriptionCache.set(fileHash, result);

      // Update stats
      this.stats.transcriptionsCompleted++;
      if (metadata.duration) {
        this.stats.totalAudioDurationSeconds += metadata.duration;
      }
      this.updateAverageProcessingTime(result.processingTimeMs);

      console.log(`[${this.name}] ✅ Transcription complete (${result.processingTimeMs}ms)`);
      console.log(`[${this.name}] 📝 Text: "${result.text.substring(0, 100)}..."`);

      // Emit transcription event
      await messageBroker.publish('audio_transcribed', {
        audioPath,
        text: result.text,
        metadata,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      this.stats.errorsEncountered++;
      console.error(`[${this.name}] ❌ Transcription failed:`, error.message);

      return {
        success: false,
        error: error.message,
        audioPath,
        processingTimeMs: Date.now() - startTime
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HYBRID TRANSCRIPTION ENGINE: Local → Cloud Fallback
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if local Whisper Flask server is available
   */
  async checkLocalWhisperHealth() {
    try {
      const response = await axios.get(`${this.config.localWhisperUrl}/health`, {
        timeout: 3000
      });
      this.localWhisperAvailable = response.data?.status === 'operational';
      if (this.localWhisperAvailable) {
        const device = response.data?.device || 'unknown';
        console.log(`[${this.name}] ✅ Local Whisper server ready (${device})`);
      }
      return this.localWhisperAvailable;
    } catch (error) {
      this.localWhisperAvailable = false;
      console.warn(`[${this.name}] ⚠️  Local Whisper not available at ${this.config.localWhisperUrl}`);
      return false;
    }
  }

  /**
   * Transcribe using hybrid strategy: local first, cloud fallback
   */
  async transcribeWithFallback(audioPath, options = {}) {
    // Strategy 1: Local Whisper (free, fast, private)
    if (this.config.preferLocal) {
      try {
        // Re-check health if we thought it was down
        if (!this.localWhisperAvailable) {
          await this.checkLocalWhisperHealth();
        }

        if (this.localWhisperAvailable) {
          const result = await this.callLocalWhisper(audioPath, options);
          this.stats.localTranscriptions++;
          console.log(`[${this.name}] 🏠 Transcribed via local Whisper`);
          return result;
        }
      } catch (error) {
        console.warn(`[${this.name}] ⚠️  Local Whisper failed: ${error.message}`);
        this.localWhisperAvailable = false;
      }
    }

    // Strategy 2: OpenAI Whisper API (cloud fallback)
    if (this.config.whisperApiKey) {
      console.log(`[${this.name}] ☁️  Falling back to OpenAI Whisper API...`);
      const result = await this.callWhisperAPI(audioPath, options);
      this.stats.cloudTranscriptions++;
      console.log(`[${this.name}] ☁️  Transcribed via OpenAI Whisper`);
      return result;
    }

    throw new Error('No transcription backend available — local Whisper is down and no OPENAI_API_KEY configured');
  }

  /**
   * Call local Whisper Flask server (port 5002)
   */
  async callLocalWhisper(audioPath, options = {}) {
    try {
      const formData = new FormData();
      const audioBuffer = await fs.readFile(audioPath);

      formData.append('audio', audioBuffer, {
        filename: path.basename(audioPath),
        contentType: this.getContentType(audioPath)
      });

      const response = await axios.post(
        `${this.config.localWhisperUrl}/transcribe`,
        formData,
        {
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 30000 // 30 second timeout for local
        }
      );

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Local transcription failed');
      }

      // Normalize response to match OpenAI format
      return {
        text: response.data.text,
        language: response.data.language || options.language || 'en',
        source: 'local'
      };

    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
        throw new Error(`Local Whisper unreachable at ${this.config.localWhisperUrl}`);
      }
      throw new Error(`Local Whisper error: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Call OpenAI Whisper API (cloud fallback)
   */
  async callWhisperAPI(audioPath, options = {}) {
    if (!this.config.whisperApiKey) {
      throw new Error('No Whisper API key configured');
    }

    try {
      // Create form data
      const formData = new FormData();
      const audioBuffer = await fs.readFile(audioPath);

      formData.append('file', audioBuffer, {
        filename: path.basename(audioPath),
        contentType: this.getContentType(audioPath)
      });

      formData.append('model', this.config.whisperModel);

      // Optional parameters
      if (options.language || this.config.language) {
        formData.append('language', options.language || this.config.language);
      }

      if (options.prompt) {
        formData.append('prompt', options.prompt);
      }

      if (this.config.enableTimestamps) {
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'segment');
      }

      // Call API
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${this.config.whisperApiKey}`
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000 // 60 second timeout
        }
      );

      return { ...response.data, source: 'cloud' };

    } catch (error) {
      if (error.response) {
        throw new Error(`Whisper API error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Whisper API timeout (file too large or slow connection)');
      } else {
        throw new Error(`Whisper API call failed: ${error.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIO CLASSIFICATION & UNDERSTANDING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Classify audio content (music, speech, noise, etc.)
   *
   * Note: Basic implementation. Could be enhanced with:
   * - ML-based audio classification
   * - Sound event detection
   * - Music genre classification
   */
  async classifyAudio(audioPath, candidateLabels = null) {
    try {
      console.log(`[${this.name}] 🎵 Classifying audio: ${path.basename(audioPath)}`);

      // For now, use simple heuristics based on transcription
      // In production, you'd use actual audio classification models

      const metadata = {
        format: path.extname(audioPath).toLowerCase(),
        size: (await fs.stat(audioPath)).size,
        hasTranscript: false
      };

      // Try to transcribe to see if it's speech
      const transcription = await this.transcribeSpeech(audioPath);

      if (transcription.success && transcription.text.length > 10) {
        metadata.hasTranscript = true;
        metadata.classification = 'speech';
        metadata.confidence = 0.9;
      } else {
        metadata.classification = 'unknown';
        metadata.confidence = 0.3;
      }

      return {
        success: true,
        audioPath,
        classification: metadata.classification,
        confidence: metadata.confidence,
        metadata
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ Classification failed:`, error.message);
      return {
        success: false,
        error: error.message,
        audioPath
      };
    }
  }

  /**
   * Detect speaker in audio
   *
   * Note: Basic implementation. Whisper doesn't do speaker diarization by default.
   * For production, you'd need additional tools like pyannote.audio
   */
  async detectSpeaker(audioPath) {
    console.log(`[${this.name}] 👤 Speaker detection not yet implemented`);
    console.log(`[${this.name}] Consider using pyannote.audio for speaker diarization`);

    return {
      success: false,
      error: 'Speaker detection not implemented',
      note: 'Use pyannote.audio or similar for speaker diarization'
    };
  }

  /**
   * Analyze sentiment from audio
   *
   * Note: Would require additional ML models or API
   * For now, returns placeholder
   */
  async analyzeSentiment(audioPath) {
    console.log(`[${this.name}] 😊 Audio sentiment analysis not yet implemented`);

    return {
      success: false,
      error: 'Audio sentiment analysis not implemented',
      note: 'Could use speech emotion recognition models'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-MODAL FUSION (Future Enhancement)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fuse audio and vision data for multi-modal understanding
   *
   * @param {string} audioPath - Path to audio file
   * @param {string} imagePath - Path to image file
   */
  async fuseAudioVision(audioPath, imagePath) {
    const startTime = Date.now();
    console.log(`[${this.name}] 🎬 Performing multi-modal audio-vision fusion...`);

    try {
      // 1. Transcribe audio
      const audioResult = await this.transcribe(audioPath);
      const transcription = audioResult?.text || '';

      // 2. Obtain visual perception from registered vision arbiter if available
      let visualContext = null;
      const visionArbiter = messageBroker.getArbiter('VisionProcessingArbiter')?.instance
        || messageBroker.getArbiter('VisionArbiter')?.instance;

      if (visionArbiter && typeof visionArbiter.analyzeImage === 'function') {
        try {
          visualContext = await visionArbiter.analyzeImage(imagePath);
        } catch (err) {
          console.warn(`[${this.name}] Vision analysis fallback: ${err.message}`);
        }
      }

      // 3. Synthesize multi-modal context
      const fused = {
        success: true,
        audioPath,
        imagePath,
        transcription,
        visualContext: visualContext || { imagePath, status: 'unprocessed_visual' },
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      await messageBroker.publish('multimodal_fusion_perceived', fused);
      return fused;
    } catch (err) {
      console.error(`[${this.name}] ❌ Multi-modal fusion error:`, err.message);
      return {
        success: false,
        error: err.message,
        audioPath,
        imagePath,
        processingTimeMs: Date.now() - startTime
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  async handleTranscriptionRequest(payload) {
    const { audioPath, options = {}, requestId } = payload;

    console.log(`[${this.name}] 📨 Transcription request received: ${path.basename(audioPath)}`);

    const result = await this.transcribeSpeech(audioPath, options);

    // Send response
    if (requestId) {
      await messageBroker.publish('transcription_response', {
        requestId,
        result,
        timestamp: Date.now()
      });
    }
  }

  async handleAudioReceived(payload) {
    const { audioPath, autoTranscribe = true } = payload;

    console.log(`[${this.name}] 🎤 Audio file received: ${path.basename(audioPath)}`);

    // Store metadata
    this.audioMetadata.set(audioPath, {
      receivedAt: Date.now(),
      processed: false
    });

    // Auto-transcribe if enabled
    if (autoTranscribe) {
      await this.transcribeSpeech(audioPath);

      const metadata = this.audioMetadata.get(audioPath);
      metadata.processed = true;
      metadata.processedAt = Date.now();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileHash(filePath) {
    const crypto = require('crypto');
    const buffer = await fs.readFile(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  getContentType(audioPath) {
    const ext = path.extname(audioPath).toLowerCase();
    const contentTypes = {
      '.mp3': 'audio/mpeg',
      '.mp4': 'audio/mp4',
      '.mpeg': 'audio/mpeg',
      '.mpga': 'audio/mpeg',
      '.m4a': 'audio/m4a',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm'
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  updateAverageProcessingTime(newTime) {
    const count = this.stats.transcriptionsCompleted;
    this.stats.averageProcessingTime =
      ((this.stats.averageProcessingTime * (count - 1)) + newTime) / count;
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      ...this.stats,
      localWhisperAvailable: this.localWhisperAvailable,
      cacheSize: this.transcriptionCache.size,
      audioFilesTracked: this.audioMetadata.size,
      averageProcessingTime: Math.round(this.stats.averageProcessingTime)
    };
  }

  /**
   * Clear transcription cache
   */
  clearCache() {
    const cacheSize = this.transcriptionCache.size;
    this.transcriptionCache.clear();
    console.log(`[${this.name}] 🗑️  Cleared ${cacheSize} cached transcriptions`);
  }

  /**
   * Lifecycle: Deactivate arbiter
   */
  async onDeactivate() {
    console.log(`[${this.name}] 🛑 Deactivating Audio Processing system...`);

    // Log final stats
    console.log(`[${this.name}] 📊 Final stats:`, this.getStats());

    console.log(`[${this.name}] ✅ Audio Processing deactivated`);
  }
}

module.exports = AudioProcessingArbiter;
