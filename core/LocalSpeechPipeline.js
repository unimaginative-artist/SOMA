/**
 * core/LocalSpeechPipeline.js
 * 
 * Local speech-to-text (STT) and text-to-speech (TTS) pipeline.
 * Formats spoken responses for natural voice channels, strips markdown / raw code,
 * and interfaces with local TTS service at http://localhost:8081/tts and Whisper STT.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

export class LocalSpeechPipeline {
    constructor(options = {}) {
        this.ttsUrl = options.ttsUrl || process.env.TTS_URL || 'http://localhost:8081/tts';
        this.whisperUrl = options.whisperUrl || process.env.WHISPER_URL || 'http://localhost:8000/v1/audio/transcriptions';
        this.voiceDir = options.voiceDir || path.join(process.cwd(), '.soma', 'voice');
    }

    /**
     * Format written assistant text into spoken-friendly audio prompt.
     * Strips Markdown, code blocks, URLs, and excessive emoji.
     */
    formatForSpeech(text = '') {
        if (!text) return '';
        let spoken = String(text);

        // Remove markdown fenced code blocks (e.g. ```javascript ... ```)
        spoken = spoken.replace(/```[\s\S]*?```/g, ' [code omitted, check chat] ');

        // Remove inline backticks
        spoken = spoken.replace(/`([^`]+)`/g, '$1');

        // Remove URLs
        spoken = spoken.replace(/https?:\/\/\S+/g, 'link in chat');

        // Remove markdown headers, bold, italics, bullets
        spoken = spoken.replace(/^[#\*\-\s>]+/gm, '');
        spoken = spoken.replace(/\*\*([^*]+)\*\*/g, '$1');
        spoken = spoken.replace(/\*([^*]+)\*/g, '$1');

        // Collapse excess whitespace
        spoken = spoken.replace(/\s+/g, ' ').trim();

        // If overly long, truncate spoken portion to ~300 chars
        if (spoken.length > 320) {
            spoken = spoken.slice(0, 300) + '... Full details posted to the chat channel.';
        }

        return spoken;
    }

    /**
     * Synthesize audio from text via local TTS server
     */
    async synthesize(text) {
        const spokenText = this.formatForSpeech(text);
        if (!spokenText) return null;

        try {
            const res = await fetch(this.ttsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: spokenText })
            });

            if (!res.ok) {
                throw new Error(`TTS server returned status ${res.status}`);
            }

            const buffer = Buffer.from(await res.arrayBuffer());
            if (!existsSync(this.voiceDir)) {
                await fs.mkdir(this.voiceDir, { recursive: true });
            }
            const filePath = path.join(this.voiceDir, `speech_${Date.now()}.wav`);
            await fs.writeFile(filePath, buffer);

            return {
                spokenText,
                filePath,
                buffer,
                size: buffer.length
            };
        } catch (e) {
            // Non-fatal fallback for test environments or offline TTS
            return {
                spokenText,
                filePath: null,
                buffer: null,
                error: e.message
            };
        }
    }

    /**
     * Transcribe PCM / WAV audio buffer to text via local Whisper
     */
    async transcribe(audioBuffer) {
        if (!audioBuffer || audioBuffer.length === 0) return '';
        try {
            const formData = new FormData();
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            formData.append('file', blob, 'speech.wav');
            formData.append('model', 'whisper-1');

            const res = await fetch(this.whisperUrl, {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error(`Whisper STT returned ${res.status}`);
            const data = await res.json();
            return data.text || '';
        } catch (e) {
            return '';
        }
    }
}

export default new LocalSpeechPipeline();
