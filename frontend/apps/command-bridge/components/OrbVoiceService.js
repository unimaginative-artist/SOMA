/**
 * OrbVoiceService - Handles voice interactions for the Orb
 * - Web Audio API for volume visualization
 * - Web Speech Recognition for voice input
 * - Text-to-Speech for voice output
 * - Connects to SOMA backend for reasoning
 */

class OrbVoiceService {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.recognition = null;
    this.synthesis = window.speechSynthesis;
    this.onVolumeChange = null;
    this.onTranscript = null;
    this.onError = null;
    this.volumeCheckInterval = null;
    this.isListening = false;
    this._wantListening = false; // user intent, separate from API state
  }

  /**
   * Start listening to microphone input
   */
  async startListening() {
    try {
      // Initialize Web Audio API for volume monitoring
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512; // Smaller for better performance
      this.analyser.smoothingTimeConstant = 0.8; // Smooth out the volume

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });

      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);

      // Start volume monitoring
      this.monitorVolume();

      // Initialize speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        throw new Error('Speech Recognition not supported in this browser. Please use Chrome or Edge.');
      }

      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        console.log('[OrbVoice] Recognition started');
        this.isListening = true;
        this._wantListening = true;
      };

      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const confidence = event.results[0][0].confidence;
        console.log(`[OrbVoice] Recognized: "${transcript}" (${(confidence * 100).toFixed(1)}% confidence)`);

        if (this.onTranscript) {
          this.onTranscript(transcript, confidence);
        }
      };

      this.recognition.onerror = (event) => {
        console.error('[OrbVoice] Recognition error:', event.error);

        if (this.onError) {
          this.onError({
            type: 'recognition',
            message: `Speech recognition error: ${event.error}`,
            error: event.error
          });
        }

        // Auto-restart on certain errors
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          setTimeout(() => {
            if (this._wantListening) {
              this.recognition?.start();
            }
          }, 1000);
        }
      };

      this.recognition.onend = () => {
        console.log('[OrbVoice] Recognition ended');
        this.isListening = false;

        // Auto-restart if user still wants to be listening
        setTimeout(() => {
          if (this._wantListening) {
            this.recognition?.start();
          }
        }, 500);
      };

      this.recognition.start();
      console.log('[OrbVoice] ✅ Voice service started successfully');

    } catch (error) {
      console.error('[OrbVoice] Failed to start listening:', error);

      if (this.onError) {
        this.onError({
          type: 'initialization',
          message: error.message,
          error
        });
      }

      // Show user-friendly error
      if (error.name === 'NotAllowedError') {
        alert('Microphone access denied. Please allow microphone access to use voice features.');
      } else if (error.name === 'NotFoundError') {
        alert('No microphone found. Please connect a microphone to use voice features.');
      } else {
        alert(`Voice service error: ${error.message}`);
      }
    }
  }

  /**
   * Monitor audio volume and trigger callbacks
   */
  monitorVolume() {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const update = () => {
      if (!this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate average volume
      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;
      const normalizedVolume = Math.min(average / 128, 1); // 0 to 1, capped

      // Trigger callback
      if (this.onVolumeChange) {
        this.onVolumeChange(normalizedVolume);
      }

      // Continue monitoring
      this.volumeCheckInterval = requestAnimationFrame(update);
    };

    update();
  }

  /**
   * Stop listening and cleanup
   */
  stopListening() {
    console.log('[OrbVoice] Stopping voice service...');

    this.isListening = false;
    this._wantListening = false;

    // Stop recognition
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }

    // Stop volume monitoring
    if (this.volumeCheckInterval) {
      cancelAnimationFrame(this.volumeCheckInterval);
      this.volumeCheckInterval = null;
    }

    // Disconnect microphone
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log('[OrbVoice] Voice service stopped');
  }

  /**
   * Speak text using Text-to-Speech
   * @param {string} text - Text to speak
   * @param {Object} options - TTS options
   * @returns {Promise} - Resolves when speech is complete
   */
  async speak(text, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.synthesis) {
        reject(new Error('Speech synthesis not supported'));
        return;
      }

      // Cancel any ongoing speech
      this.synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      // Configure voice options
      utterance.rate = options.rate || 1.0;
      utterance.pitch = options.pitch || 1.0;
      utterance.volume = options.volume || 1.0;
      utterance.lang = options.lang || 'en-US';

      // Try to find a nice voice — wait for voices to load if needed
      const applyVoice = () => {
        const voices = this.synthesis.getVoices();
        const preferredVoice = voices.find(v =>
          v.lang.startsWith('en') && (v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Samantha'))
        ) || voices.find(v => v.lang.startsWith('en'));
        if (preferredVoice) utterance.voice = preferredVoice;
      };

      if (this.synthesis.getVoices().length === 0) {
        this.synthesis.onvoiceschanged = () => { applyVoice(); this.synthesis.onvoiceschanged = null; };
      } else {
        applyVoice();
      }

      utterance.onstart = () => {
        console.log('[OrbVoice] Started speaking:', text.substring(0, 50) + '...');
      };

      utterance.onend = () => {
        console.log('[OrbVoice] Finished speaking');
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('[OrbVoice] Speech error:', event.error);
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };

      this.synthesis.speak(utterance);
    });
  }

  /**
   * Check if speech recognition is supported
   */
  static isRecognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Check if speech synthesis is supported
   */
  static isSynthesisSupported() {
    return !!window.speechSynthesis;
  }

  /**
   * Get available voices
   */
  getVoices() {
    return this.synthesis?.getVoices() || [];
  }
}

// Create singleton instance
const orbVoiceService = new OrbVoiceService();

export default orbVoiceService;
