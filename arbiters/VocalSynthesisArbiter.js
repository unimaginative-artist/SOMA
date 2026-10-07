import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * VocalSynthesisArbiter — PROJECT SIREN
 * v1.0 — Human-Identical Voice Engine + Native Speech Synthesis Fallback
 */
export class VocalSynthesisArbiter extends BaseArbiter {
  static role = 'vocal-synthesis';
  static capabilities = [
    'generate-speech',
    'voice-cloning',
    'emotional-prosody',
    'real-time-streaming',
    'local-playback'
  ];

  constructor(id, config = {}) {
    super(id, config);
    this.name = 'VocalSynthesisArbiter';
    this.config = {
      primaryEngine: config.primaryEngine || 'fish-speech',
      fishSpeechUrl: config.fishSpeechUrl || 'http://localhost:8081',
      elevenLabsKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID || 'nf4MCGNSdM0hxM95ZBQR',
      playLocal: config.playLocal !== false,
      ...config
    };
  }

  async onInitialize() {
    console.log('[Siren] 🧜‍♀️ Initializing Human-Identical Voice Engine...');
    
    const cacheDir = path.join(process.cwd(), 'data', 'audio', 'cache');
    await fs.mkdir(cacheDir, { recursive: true });

    this.currentChemistry = { dopamine: 0.5, cortisol: 0.1, oxytocin: 0.5, serotonin: 0.5 };
    this.currentWeather = 'CLEAR';

    messageBroker.subscribe('limbic_update', (msg) => {
      const payload = msg?.payload || msg || {};
      if (payload.chemistry) this.currentChemistry = payload.chemistry;
      if (payload.weather) this.currentWeather = payload.weather;
    });

    messageBroker.subscribe('vocal_synthesis_requested', async (msg) => {
      try {
        await this.handleSynthesis(msg.payload || msg);
      } catch (err) {
        console.error('[Siren] Async synthesis error:', err.message);
      }
    });

    console.log('[Siren] ✅ Vocal Synthesis online.');
  }

  async handleSynthesis(payload = {}) {
    const { text, requestId } = payload;
    if (!text) return { success: false, error: 'No text provided' };

    const emotion = payload.emotion || this._getEmotionFromWeather();
    console.log(`[Siren] 🗣️ Synthesizing (${this.currentWeather}/${emotion}): "${text.slice(0, 50)}..."`);

    let result = { success: false };

    // 1. Attempt FishSpeech (Local)
    if (this.config.primaryEngine === 'fish-speech') {
      result = await this._synthesizeFish(text, emotion);
      if (!result.success) console.warn(`[Siren] ⚠️ Local engine failed: ${result.error}`);
    }

    // 2. Fallback to ElevenLabs (Cloud)
    if (!result.success && this.config.elevenLabsKey) {
      console.log('[Siren] ☁️ Falling back to ElevenLabs...');
      result = await this._synthesizeEleven(text, emotion);
    }

    // 3. Native System Speech Fallback (Windows SAPI)
    if (!result.success) {
      console.log('[Siren] 🔊 Falling back to Native System Speech...');
      result = await this._synthesizeNative(text);
    }

    // 4. Play Locally if audio file was generated
    if (result.success && result.audioPath && this.config.playLocal) {
      this._playLocal(result.audioPath);
    }

    if (requestId) {
      await messageBroker.publish('vocal_synthesis_ready', {
        requestId,
        audioPath: result.audioPath,
        success: result.success
      });
    }

    return result;
  }

  _synthesizeNative(text) {
    return new Promise((resolve) => {
      const cleanText = String(text || '').replace(/"/g, '`"').replace(/'/g, "''");
      const psScript = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Rate = 1; $synth.Speak("${cleanText}");`;
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, (err) => {
        if (err) {
          console.warn('[Siren] Native speech fallback error:', err.message);
          resolve({ success: false, error: err.message });
        } else {
          console.log('[Siren] ✅ Native speech spoke out loud successfully!');
          resolve({ success: true, native: true });
        }
      });
    });
  }

  _playLocal(filePath) {
    console.log(`[Siren] 🔊 Playing: ${path.basename(filePath)}`);
    const psCommand = `
      Add-Type -AssemblyName PresentationCore;
      $player = New-Object System.Windows.Media.MediaPlayer;
      $player.Open('${filePath}');
      $player.Play();
      Start-Sleep -Seconds 3;
      $player.Close();
    `.replace(/\n/g, ' ');

    exec(`powershell -NoProfile -Command "${psCommand}"`, (err) => {
      if (err) console.warn('[Siren] Local playback failed:', err.message);
    });
  }

  _getEmotionFromWeather() {
    const w = this.currentWeather;
    if (w === 'STORM') return 'stressed';
    if (w === 'FLOW') return 'excited';
    if (w === 'BONDING') return 'warm';
    if (w === 'FRAGMENTED') return 'jittery';
    return 'neutral';
  }

  async _synthesizeFish(text, emotion) {
    try {
      const response = await axios.post(`${this.config.fishSpeechUrl}/v1/tts`, {
        text,
        prosody: this._mapEmotionToProsody(emotion),
        streaming: false
      }, {
        responseType: 'arraybuffer',
        timeout: 5000
      });

      if (!response.data || response.data.byteLength < 100) {
        return { success: false, error: 'Empty audio buffer returned' };
      }

      const filename = `siren_${Date.now()}.wav`;
      const filePath = path.join(process.cwd(), 'data', 'audio', 'cache', filename);
      await fs.writeFile(filePath, response.data);

      return { success: true, audioPath: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _synthesizeEleven(text, emotion) {
    try {
      if (!this.config.elevenLabsKey) return { success: false, error: 'No ElevenLabs API key' };
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}`;
      const response = await axios.post(url, {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }, {
        headers: { 'xi-api-key': this.config.elevenLabsKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 15000
      });

      const filename = `siren_eleven_${Date.now()}.mp3`;
      const filePath = path.join(process.cwd(), 'data', 'audio', 'cache', filename);
      await fs.writeFile(filePath, response.data);

      return { success: true, audioPath: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _mapEmotionToProsody(emotion) {
    const maps = {
      stressed: { speed: 1.2, pitch: 1.1 },
      excited: { speed: 1.15, pitch: 1.2 },
      warm: { speed: 0.95, pitch: 0.95 },
      jittery: { speed: 1.3, pitch: 1.25 },
      neutral: { speed: 1.0, pitch: 1.0 }
    };
    return maps[emotion] || maps.neutral;
  }
}

export default VocalSynthesisArbiter;
