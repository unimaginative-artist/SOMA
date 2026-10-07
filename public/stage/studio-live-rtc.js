export class StudioLiveRTC {
  constructor({ request, onRemoteStream = () => {}, onState = () => {}, rtcConfig = null, peerFactory = null, transport = null } = {}) {
    if (typeof request !== 'function') throw new Error('StudioLiveRTC requires a signaling request function');
    this.request = request;
    this.onRemoteStream = onRemoteStream;
    this.onState = onState;
    this.rtcConfig = rtcConfig || {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
    this.peerFactory = peerFactory || (config => new RTCPeerConnection(config));
    this.peerId = globalThis.crypto?.randomUUID?.() || `peer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.role = '';
    this.roomId = '';
    this.localStream = null;
    this.peers = new Map();
    this.pendingIce = new Map();
    this.closed = false;
    this.reconnects = 0;
    this.reconnectTimer = null;
    this.transport = transport || { provider: 'p2p' };
    this.livekitRoom = null;
    this.livekitModule = null;
    this.livekitRemoteStream = null;
  }

  async startHost(roomId, stream) {
    this.closed = false;
    this.role = 'host';
    this.roomId = roomId;
    this.localStream = stream;
    if (this.transport.provider === 'livekit') {
      await this._connectLiveKit(stream);
      return;
    }
    this._state('hosting');
  }

  async joinViewer(roomId) {
    this.closed = false;
    this.role = 'viewer';
    this.roomId = roomId;
    if (this.transport.provider === 'livekit') {
      await this._connectLiveKit(null);
      return;
    }
    this._state('connecting');
    await this._offerToHost();
  }

  async handle(event = {}) {
    if (this.transport.provider === 'livekit') return;
    if (this.closed || !this.roomId || event.roomId !== this.roomId) return;
    const signal = event.signal || {};
    if (!signal.kind || signal.peerId === this.peerId) return;
    if (signal.targetPeerId && signal.targetPeerId !== this.peerId) return;

    if (signal.kind === 'offer' && this.role === 'host') {
      const pc = this._peer(signal.peerId, { sendTo: signal.peerId });
      await pc.setRemoteDescription(signal.description);
      await this._flushIce(signal.peerId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this._signal('answer', {
        peerId: this.peerId,
        targetPeerId: signal.peerId,
        description: pc.localDescription || answer,
      });
      return;
    }

    if (signal.kind === 'answer' && this.role === 'viewer') {
      const pc = this.peers.get('host');
      if (!pc) return;
      pc.__remotePeerId = signal.peerId;
      await pc.setRemoteDescription(signal.description);
      await this._flushIce(signal.peerId || 'host', pc);
      this._state('connected');
      this.reconnects = 0;
      return;
    }

    if (signal.kind === 'ice') {
      const key = this.role === 'viewer' ? 'host' : signal.peerId;
      const pc = this.peers.get(key);
      if (pc?.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else {
        const queue = this.pendingIce.get(key) || [];
        queue.push(signal.candidate);
        this.pendingIce.set(key, queue);
      }
      return;
    }

    if (signal.kind === 'leave') this._dropPeer(this.role === 'viewer' ? 'host' : signal.peerId);
  }

  async replaceStream(stream) {
    this.localStream = stream;
    if (this.livekitRoom) {
      const participant = this.livekitRoom.localParticipant;
      const publications = [...participant.trackPublications.values()];
      for (const publication of publications) {
        if (publication.track) await participant.unpublishTrack(publication.track, true);
      }
      for (const track of stream.getTracks()) await participant.publishTrack(track, { simulcast: track.kind === 'video' });
      this._state('media-updated');
      return;
    }
    for (const pc of this.peers.values()) {
      for (const sender of pc.getSenders?.() || []) {
        const replacement = stream.getTracks().find(track => track.kind === sender.track?.kind);
        if (replacement) await sender.replaceTrack(replacement);
      }
      const senderKinds = new Set((pc.getSenders?.() || []).map(sender => sender.track?.kind));
      for (const track of stream.getTracks()) {
        if (!senderKinds.has(track.kind)) pc.addTrack(track, stream);
      }
    }
    this._state('media-updated');
  }

  setTrackEnabled(kind, enabled) {
    for (const track of this.localStream?.getTracks?.() || []) {
      if (track.kind === kind) track.enabled = Boolean(enabled);
    }
    if (this.livekitRoom) {
      for (const publication of this.livekitRoom.localParticipant.trackPublications.values()) {
        if (publication.track?.mediaStreamTrack?.kind !== kind) continue;
        if (enabled) publication.unmute?.();
        else publication.mute?.();
      }
    }
    this._state(`${kind}-${enabled ? 'on' : 'off'}`);
  }

  async shareScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is unavailable');
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const original = this.localStream;
    await this.replaceStream(display);
    const video = display.getVideoTracks()[0];
    if (video) video.onended = async () => {
      if (!this.closed && original) await this.replaceStream(original);
      for (const track of display.getTracks()) track.stop();
    };
    return display;
  }

  async close({ stopLocal = false } = {}) {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    if (this.livekitRoom) {
      await this.livekitRoom.disconnect();
      this.livekitRoom = null;
      this.livekitRemoteStream = null;
    } else if (this.roomId) {
      const targets = [...this.peers.keys()];
      await Promise.allSettled(targets.map(target => this._signal('leave', {
        peerId: this.peerId,
        targetPeerId: target === 'host' ? '' : target,
        targetRole: target === 'host' ? 'host' : '',
      })));
    }
    for (const key of [...this.peers.keys()]) this._dropPeer(key);
    if (stopLocal) for (const track of this.localStream?.getTracks?.() || []) track.stop();
    this.localStream = null;
    this.roomId = '';
    this.role = '';
    this._state('closed');
  }

  async _offerToHost() {
    const pc = this._peer('host', { receiveOnly: true, sendToRole: 'host' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this._signal('offer', {
      peerId: this.peerId,
      targetRole: 'host',
      description: pc.localDescription || offer,
    });
  }

  async _connectLiveKit(stream) {
    if (!this.transport.url || !this.transport.token) throw new Error('LiveKit transport is missing its URL or join token');
    this._state('sfu-connecting');
    const mod = await import('/api/studio/live/vendor/livekit-client.mjs');
    this.livekitModule = mod;
    const room = new mod.Room({
      adaptiveStream: this.transport.adaptiveStream !== false,
      dynacast: this.transport.dynacast !== false,
    });
    this.livekitRoom = room;
    this.livekitRemoteStream = typeof MediaStream !== 'undefined' ? new MediaStream() : null;
    room.on(mod.RoomEvent.TrackSubscribed, track => {
      const mediaTrack = track.mediaStreamTrack;
      if (!mediaTrack || !this.livekitRemoteStream) return;
      for (const existing of this.livekitRemoteStream.getTracks()) {
        if (existing.kind === mediaTrack.kind) this.livekitRemoteStream.removeTrack(existing);
      }
      this.livekitRemoteStream.addTrack(mediaTrack);
      this.onRemoteStream(this.livekitRemoteStream);
    });
    room.on(mod.RoomEvent.Reconnecting, () => this._state('sfu-reconnecting'));
    room.on(mod.RoomEvent.Reconnected, () => this._state('connected'));
    room.on(mod.RoomEvent.Disconnected, () => this._state('disconnected'));
    await room.connect(this.transport.url, this.transport.token);
    if (this.role === 'host' && stream) {
      for (const track of stream.getTracks()) await room.localParticipant.publishTrack(track, { simulcast: track.kind === 'video' });
      this._state('hosting-sfu');
    } else {
      this._state('connected');
    }
  }

  _peer(key, { receiveOnly = false, sendTo = '', sendToRole = '' } = {}) {
    if (this.peers.has(key)) return this.peers.get(key);
    const pc = this.peerFactory(this.rtcConfig);
    pc.__remotePeerId = sendTo;
    this.peers.set(key, pc);
    if (this.role === 'host' && this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    } else if (receiveOnly && pc.addTransceiver) {
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.closed) return;
      this._signal('ice', {
        peerId: this.peerId,
        targetPeerId: pc.__remotePeerId || sendTo,
        targetRole: pc.__remotePeerId || sendTo ? '' : sendToRole,
        candidate,
      }).catch(() => this._state('signaling-error'));
    };
    pc.ontrack = event => {
      const stream = event.streams?.[0] || (typeof MediaStream !== 'undefined' ? new MediaStream([event.track]) : null);
      if (stream) this.onRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState || 'unknown';
      this._state(state);
      if (['failed', 'disconnected'].includes(state) && this.role === 'viewer') this._scheduleReconnect();
      if (state === 'closed') this.peers.delete(key);
    };
    return pc;
  }

  async _signal(kind, body) {
    if (!this.roomId) return null;
    return this.request(`/api/studio/live/${encodeURIComponent(this.roomId)}/webrtc/${kind}`, body);
  }

  async _flushIce(key, pc) {
    const queue = this.pendingIce.get(key) || this.pendingIce.get('host') || [];
    this.pendingIce.delete(key);
    this.pendingIce.delete('host');
    for (const candidate of queue) await pc.addIceCandidate(candidate);
  }

  _dropPeer(key) {
    const pc = this.peers.get(key);
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.close();
    }
    this.peers.delete(key);
  }

  _scheduleReconnect() {
    if (this.closed || this.reconnectTimer || this.reconnects >= 5) return;
    const delay = Math.min(1000 * (2 ** this.reconnects), 10000);
    this.reconnects += 1;
    this._state(`reconnecting-${this.reconnects}`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this._dropPeer('host');
      try { await this._offerToHost(); } catch { this._scheduleReconnect(); }
    }, delay);
  }

  _state(state) {
    this.onState({ state, role: this.role, roomId: this.roomId, peerId: this.peerId, peers: this.peers.size });
  }
}

if (typeof window !== 'undefined') window.StudioLiveRTC = StudioLiveRTC;
