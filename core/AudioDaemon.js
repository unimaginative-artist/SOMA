import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const WAKE = /\b(?:hey|hay)\s+soma\b[\s,!.:-]*/i;

export function summarizeWorkerFailure(value = '') {
    const lines = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const useful = [...lines].reverse().find(line => /(?:PortAudioError|Error opening|device|host error|not found)/i.test(line));
    return (useful || lines.at(-1) || 'Audio worker exited unexpectedly').slice(0, 500);
}

export class AudioDaemon extends EventEmitter {
    constructor({ system, pythonPath = '.soma_venv/Scripts/python.exe', workerPath = 'appendages/provenance/soma_audio_worker.py', device = null, commandWindowMs = 10_000, enabled = true, logger = console } = {}) {
        super();
        this.system = system;
        this.pythonPath = path.resolve(pythonPath);
        this.workerPath = path.resolve(workerPath);
        this.device = device;
        this.commandWindowMs = commandWindowMs;
        this.enabled = enabled;
        this.logger = logger;
        this.process = null;
        this.state = enabled ? 'stopped' : 'disabled';
        this.wakeExpiresAt = 0;
        this.lastTranscript = null;
        this.lastCommand = null;
        this.lastError = null;
        this._stderrTail = '';
    }

    start() {
        if (!this.enabled || this.process) return false;
        const args = [this.workerPath];
        if (Number.isInteger(this.device)) args.push('--device', String(this.device));
        this.process = spawn(this.pythonPath, args, { cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        this.state = 'starting';
        readline.createInterface({ input: this.process.stdout }).on('line', line => {
            try { this._handleWorkerEvent(JSON.parse(line)); } catch { this.logger.warn('[AudioDaemon] Invalid worker event'); }
        });
        this._stderrTail = '';
        this.process.stderr.on('data', data => {
            this._stderrTail = `${this._stderrTail}${String(data)}`.slice(-4000);
        });
        this.process.on('exit', code => {
            this.process = null;
            if (code) {
                this.lastError = summarizeWorkerFailure(this._stderrTail) || `Audio worker exited ${code}`;
                this.state = 'degraded';
                this.logger.warn(`[AudioDaemon] Microphone unavailable; wake-word input degraded: ${this.lastError}`);
            } else {
                this.state = this.enabled ? 'stopped' : 'disabled';
            }
        });
        this.process.on('error', error => { this.lastError = error.message; this.state = 'error'; });
        return true;
    }

    async _handleWorkerEvent(event) {
        if (event.event === 'transcript') return this.ingestTranscript(event.text, event);
        if (event.event === 'ready' || event.event === 'state') this.state = event.state;
        if (event.event === 'error' || event.event === 'fatal') { this.lastError = event.message; this.state = 'error'; }
        this.emit('audio_event', event);
    }

    async ingestTranscript(text, metadata = {}) {
        const transcript = String(text || '').trim();
        if (!transcript) return { handled: false };
        this.lastTranscript = { text: transcript, timestamp: metadata.timestamp || Date.now() };
        const wakeMatch = transcript.match(WAKE);
        if (wakeMatch) {
            const following = transcript.slice((wakeMatch.index || 0) + wakeMatch[0].length).trim();
            this.wakeExpiresAt = Date.now() + this.commandWindowMs;
            this.state = following ? 'processing' : 'awaiting_command';
            this.emit('wake', { transcript, following });
            if (!following) return { handled: true, wake: true, awaitingCommand: true };
            return this._dispatch(following, metadata);
        }
        if (Date.now() <= this.wakeExpiresAt) return this._dispatch(transcript, metadata);
        return { handled: false, reason: 'wake_word_not_present' };
    }

    async _dispatch(command, metadata) {
        this.wakeExpiresAt = 0;
        this.state = 'processing';
        const timestamp = metadata.timestamp || Date.now();
        const social = await this.system.socialIdentity?.processIntroduction?.(command, { timestamp, source: 'audio_daemon' });
        let result;
        if (social?.enrolled) result = { text: social.response, response: social.response, socialEnrollment: social.profile };
        else result = await this.system.chatRuntime.handle({ channel: 'local_voice', message: command, sessionId: 'local_voice:primary', trustedActionAuthority: false });
        this.lastCommand = { command, timestamp, transactionId: result?.cognitiveTransaction?.id || null };
        const response = result?.text || result?.response || '';
        if (response) await this.system.toolRegistry?.execute?.('desktop_speak', { text: response, listenForReply: false }).catch(() => {});
        this.state = 'armed';
        this.emit('command', { command, result });
        return { handled: true, wake: true, command, result };
    }

    mute() { this._send('mute'); this.state = 'muted'; }
    unmute() { this._send('unmute'); this.state = 'armed'; }
    arm() { this.enabled = true; return this.start(); }
    disarm() { this.enabled = false; this._send('stop'); this.process?.kill(); this.process = null; this.state = 'disabled'; }
    stop() { this.enabled = false; this._send('stop'); this.process?.kill(); this.process = null; this.state = 'disabled'; }
    _send(command) { if (this.process?.stdin?.writable) this.process.stdin.write(`${JSON.stringify({ command })}\n`); }
    getStatus() { return { enabled: this.enabled, available: !['degraded', 'error'].includes(this.state), state: this.state, mode: 'local_whisper_phrase_gate', wakePhrase: 'Hey Soma', device: this.device, lastTranscript: this.lastTranscript, lastCommand: this.lastCommand, lastError: this.lastError }; }
}

export default AudioDaemon;
