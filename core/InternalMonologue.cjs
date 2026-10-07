// ═══════════════════════════════════════════════════════════
// FILE: core/InternalMonologue.cjs
// ═══════════════════════════════════════════════════════════
// Manages SOMA's raw, unfiltered first-person thought stream.
// Appends entries to .soma/monologue.txt (pruned to 150 lines)
// and broadcasts them via WebSocket to the dashboard.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const MONOLOGUE_DIR = path.join(process.cwd(), '.soma');
const MONOLOGUE_FILE = path.join(MONOLOGUE_DIR, 'monologue.txt');
const MAX_LINES = 150;

function ensureDir() {
  if (!fs.existsSync(MONOLOGUE_DIR)) {
    fs.mkdirSync(MONOLOGUE_DIR, { recursive: true });
  }
}

/**
 * Log a raw thought from SOMA's perspective and stream it to the frontend.
 * @param {string} thought - The raw first-person thought.
 * @param {string} [source='general'] - Source component (ASIKernel, Heartbeat, etc.)
 */
function writeMonologue(thought, source = 'general') {
  if (!thought || typeof thought !== 'string') return;
  const cleanThought = thought.trim();
  if (!cleanThought) return;

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${source}] ${cleanThought}\n`;

  try {
    ensureDir();
    fs.appendFileSync(MONOLOGUE_FILE, entry);

    // Prune file to keep size bounded
    const content = fs.readFileSync(MONOLOGUE_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length > MAX_LINES) {
      const pruned = lines.slice(lines.length - MAX_LINES).join('\n') + '\n';
      fs.writeFileSync(MONOLOGUE_FILE, pruned);
    }

    // Broadcast update via global system WebSocket or MessageBroker if running
    const system = global.__SOMA_SYSTEM;
    if (system) {
      const payload = {
        thought: cleanThought,
        source,
        timestamp: Date.now()
      };
      
      // Broadcast to all WS dashboard clients
      if (system.ws?.broadcast) {
        system.ws.broadcast('monologue_stream', payload);
      }
      
      // Publish as a system signal
      if (system.messageBroker?.publish) {
        system.messageBroker.publish('monologue.pulse', payload).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[InternalMonologue] Failed to write monologue entry: ${err.message}`);
  }
}

module.exports = {
  writeMonologue
};
