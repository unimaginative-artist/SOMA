/**
 * core/DiscordVoiceGateway.js
 * 
 * Manages Discord Voice channel connectivity, speech receiver events,
 * and audio playback for real-time voice pair-programming.
 */

import { EventEmitter } from 'node:events';
import localSpeechPipeline from './LocalSpeechPipeline.js';

export class DiscordVoiceGateway extends EventEmitter {
    constructor(options = {}) {
        super();
        this.client = options.client || null;
        this.liveAgent = options.liveAgent || null;
        this.speechPipeline = options.speechPipeline || localSpeechPipeline;
        this.activeChannelId = null;
        this.connection = null;
        this.player = null;
        this.isSpeaking = false;
        this.logger = options.logger || console;
    }

    /**
     * Check if currently connected to a voice channel
     */
    isConnected() {
        return Boolean(this.connection && this.activeChannelId);
    }

    /**
     * Join a voice channel
     */
    async joinChannel(voiceChannel) {
        if (!voiceChannel || !voiceChannel.id) {
            throw new Error('Invalid Discord voice channel.');
        }

        this.activeChannelId = voiceChannel.id;
        this.logger.log?.(`[VoiceGateway] 🎙️ Joined voice channel: ${voiceChannel.name} (${voiceChannel.id})`);
        
        // Dynamic import of @discordjs/voice if available in environment
        try {
            const voiceModule = await import('@discordjs/voice').catch(() => null);
            if (voiceModule && typeof voiceModule.joinVoiceChannel === 'function') {
                this.connection = voiceModule.joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });
                this.player = voiceModule.createAudioPlayer();
                this.connection.subscribe(this.player);
            } else {
                this.connection = { mock: true, channelId: voiceChannel.id };
            }
        } catch (e) {
            this.connection = { mock: true, channelId: voiceChannel.id };
        }

        this.emit('joined', { channelId: voiceChannel.id, channelName: voiceChannel.name });
        return { ok: true, channelId: voiceChannel.id };
    }

    /**
     * Leave voice channel
     */
    async leaveChannel() {
        if (!this.isConnected()) return { ok: true, wasConnected: false };

        const previousChannel = this.activeChannelId;
        try {
            if (this.connection && typeof this.connection.destroy === 'function') {
                this.connection.destroy();
            }
        } catch (e) { /* non-fatal */ }

        this.connection = null;
        this.player = null;
        this.activeChannelId = null;
        this.isSpeaking = false;
        this.emit('left', { channelId: previousChannel });
        this.logger.log?.('[VoiceGateway] 🔕 Disconnected from voice channel.');
        return { ok: true, channelId: previousChannel };
    }

    /**
     * Handle transcribed user speech: feed into LiveConversationalAgent
     */
    async handleUserSpeech(transcript, { textChannel, user } = {}) {
        if (!transcript || !transcript.trim()) return null;
        this.logger.log?.(`[VoiceGateway] 🗣️ User spoke: "${transcript}"`);

        let agentReply = '';
        if (this.liveAgent && typeof this.liveAgent.runTurn === 'function') {
            const result = await this.liveAgent.runTurn(transcript, {
                voiceMode: true,
                onProgress: (step) => {
                    this.emit('progress', step);
                }
            });
            agentReply = result?.summary || result?.reply || 'I processed your request.';
        } else {
            agentReply = `I heard: ${transcript}`;
        }

        // Synthesize spoken voice response
        const audio = await this.speechPipeline.synthesize(agentReply);
        if (audio?.filePath && this.player) {
            try {
                const { createAudioResource } = await import('@discordjs/voice');
                const resource = createAudioResource(audio.filePath);
                this.player.play(resource);
            } catch { /* mock or fallback */ }
        }

        // Mirror summary in Discord text channel
        if (textChannel && typeof textChannel.send === 'function') {
            await textChannel.send(`🎙️ **[Voice Turn]** ${user ? user.username : 'Owner'}: *"${transcript}"*\n🧠 **SOMA:** ${agentReply}`);
        }

        return {
            transcript,
            reply: agentReply,
            audio
        };
    }
}

export default new DiscordVoiceGateway();
