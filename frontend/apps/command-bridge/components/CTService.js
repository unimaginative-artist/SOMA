// CTService.js - Socket.IO Client for Cognitive Terminal Backend
// Connects to CT backend on port 3001

import io from 'socket.io-client';

class CTService {
  constructor() {
    this.socket = null;
    this.listeners = {};
    this.connected = false;
  }

  // Connect to CT backend
  connect() {
    if (this.socket && this.socket.connected) {
      console.log('[CTService] Already connected');
      return;
    }

    console.log('[CTService] Connecting to CT backend on port 3001...');

    this.socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      timeout: 10000
    });

    this.socket.on('connect', () => {
      console.log('[CTService] ✅ Connected to CT backend');
      this.connected = true;
      this.emit('connect');
    });

    this.socket.on('disconnect', () => {
      console.log('[CTService] ⚠️ Disconnected from CT backend');
      this.connected = false;
      this.emit('disconnect');
    });

    this.socket.on('response', (data) => {
      console.log('[CTService] Response received:', data);
      this.emit('response', data);
    });

    this.socket.on('thinking', (data) => {
      console.log('[CTService] Thinking event:', data);
      this.emit('thinking', data);
    });

    this.socket.on('error', (error) => {
      console.error('[CTService] Error:', error);
      this.emit('error', error);
    });

    this.socket.on('stream', (data) => {
      // Streaming response chunks
      this.emit('stream', data);
    });

    this.socket.on('approval-required', (data) => {
      // High-stakes operation approval request
      this.emit('approval-required', data);
    });
  }

  // Send command to CT backend
  sendCommand(command) {
    if (!this.socket || !this.socket.connected) {
      console.error('[CTService] Cannot send command - not connected');
      this.emit('error', { message: 'Not connected to CT backend' });
      return false;
    }

    console.log('[CTService] Sending command:', command);

    this.socket.emit('command', {
      text: command,
      timestamp: Date.now()
    });

    return true;
  }

  // Send approval response
  sendApproval(requestId, approved, reason = '') {
    if (!this.socket || !this.socket.connected) {
      console.error('[CTService] Cannot send approval - not connected');
      return false;
    }

    this.socket.emit('approval-response', {
      requestId,
      approved,
      reason,
      timestamp: Date.now()
    });

    return true;
  }

  // Event emitter methods
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[CTService] Error in event handler for ${event}:`, error);
      }
    });
  }

  // Disconnect from CT backend
  disconnect() {
    if (this.socket) {
      console.log('[CTService] Disconnecting...');
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  // Check connection status
  isConnected() {
    return this.connected && this.socket && this.socket.connected;
  }
}

// Create singleton instance
const ctService = new CTService();

export default ctService;
