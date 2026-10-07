/**
 * capabilities/system-health.js
 *
 * Injects SOMA's current system health (CPU, RAM, uptime, heap) into
 * queries about system performance, memory, slowness, etc.
 */

import os from 'os';

export default {
  name: 'system-health',
  description: 'Live Node.js process and OS health metrics',
  category: 'data',
  priority: 70,
  timeout: 1000,

  trigger(query) {
    const q = query.toLowerCase();
    return /\b(slow|memory|ram|cpu|heap|performance|process|uptime|crash|lag|load|resource|system health|how are you running)\b/.test(q);
  },

  handler() {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
    const uptimeSec = Math.round(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const freeRAMGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const totalRAMGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);

    return {
      heap: `${heapMB}MB used / ${heapTotalMB}MB total`,
      rss: `${rssMB}MB`,
      freeRAM: `${freeRAMGB}GB / ${totalRAMGB}GB`,
      uptime: `${h}h ${m}m`,
      nodeVersion: process.version,
      platform: process.platform,
    };
  }
};
