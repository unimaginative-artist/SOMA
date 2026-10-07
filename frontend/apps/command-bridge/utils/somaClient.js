/**
 * SOMA Backend API Client
 * Connects to SOMA's reasoning engine at http://localhost:3001
 */

const SOMA_API_BASE = '';
const SOMA_WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

/**
 * Send a query to SOMA's reasoning engine
 */
export async function reasonWithSoma(
  query,
  conversationId,
  options = {}
) {
  try {
    console.log('🧠 Sending to SOMA:', query.substring(0, 50) + '...');

    const response = await fetch(`${SOMA_API_BASE}/api/soma/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: query,
        conversationId: conversationId || generateConversationId(),
        ...options,
      }),
    });

    if (!response.ok) {
      throw new Error(`SOMA API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ SOMA response received');

    return {
      success: true,
      response: data.response || data.text || data.answer,
      thoughtProcess: data.thoughtProcess || data.reasoning,
      reasoningTree: data.reasoningTree || data.thoughtProcess?.tree || null,
      conversationId: data.conversationId,
      confidence: data.confidence,
    };
  } catch (error) {
    console.error('❌ SOMA API error:', error);
    return {
      success: false,
      error: error.message || 'Failed to communicate with SOMA',
    };
  }
}

/**
 * Check if SOMA backend is running
 */
export async function checkSomaHealth() {
  try {
    const response = await fetch(`${SOMA_API_BASE}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch (error) {
    console.warn('SOMA backend not reachable:', error);
    return false;
  }
}

/**
 * Store memory in SOMA
 */
export async function storeMemory(memory) {
  try {
    const response = await fetch(`${SOMA_API_BASE}/api/memory/store`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(memory),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to store memory:', error);
    return false;
  }
}

/**
 * Recall memories from SOMA
 */
export async function recallMemory(query) {
  try {
    const response = await fetch(`${SOMA_API_BASE}/api/memory/recall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    return data.memories || [];
  } catch (error) {
    console.error('Failed to recall memory:', error);
    return [];
  }
}

/**
 * Create WebSocket connection to SOMA's cognitive stream
 * This allows observing SOMA's internal thought process in real-time
 */
export class SomaCognitiveStream {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${SOMA_WS_BASE}/ws/cognitive`);

        this.ws.onopen = () => {
          console.log('🔌 Connected to SOMA cognitive stream');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const cognitiveEvent = JSON.parse(event.data);
            this.emit(cognitiveEvent.type, cognitiveEvent);
            this.emit('*', cognitiveEvent); // Wildcard for all events
          } catch (error) {
            console.error('Failed to parse cognitive event:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('❌ Disconnected from SOMA cognitive stream');
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
  }

  off(eventType, callback) {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  emit(eventType, event) {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.forEach(callback => callback(event));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }

  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Generate a unique conversation ID
 */
function generateConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Helper to format SOMA's response for speech
 */
export function formatResponseForSpeech(response) {
  let text = response
    .replace(/\*\*(.*?)\*\*/g, '$1')           // Bold
    .replace(/\*(.*?)\*/g, '$1')               // Italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')         // Code blocks — drop them, unreadable aloud
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // Links
    .replace(/#{1,6}\s+/g, '');                // Headers

  // Convert numbered lists to spoken form: "1. Item" → "First, Item"
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
  let listIdx = 0;
  text = text.replace(/^\s*\d+\.\s+/gm, () => {
    const word = ordinals[listIdx] || `${listIdx + 1}`;
    listIdx++;
    return `${word}, `;
  });

  // Convert bullet points to natural pauses
  text = text.replace(/^\s*[-*•]\s+/gm, '... ');

  // Collapse whitespace
  text = text.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');

  // Trim filler openers SOMA sometimes adds in text mode
  text = text.replace(/^(Certainly!?\s*|Absolutely!?\s*|Of course!?\s*|Sure!?\s*|Great!?\s*)/i, '');

  return text.trim();
}